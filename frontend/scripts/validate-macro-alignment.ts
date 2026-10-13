// scripts/validate-macro-alignment.ts
// AT24 Macro Alignment (gold) - scoring, data fetch and brief-extras formatters.
// Pure/in-memory: every network call is an injected fake. `npm run validate:macro-alignment`.

import assert from "node:assert/strict";
import { computeMacroAlignment, alignmentLine, TOTAL_WEIGHT, MIN_DRIVERS, type MacroInputs, type DriverId } from "../services/macro/macro-alignment";
import { fetchMacroInputs, resetMacroCacheForTests, type FetchLike } from "../services/macro/macro-data";
import { formatEventLines, formatPriceLine, istDateKey, countdown } from "../services/automation/brief-extras";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const mk = (v: Partial<Record<DriverId, number | null>>): MacroInputs => {
  const base = (id: DriverId): MacroInputs[DriverId] => ({ value: v[id] ?? null, unit: "u", source: `src-${id}`, asOf: null });
  return { realYield: base("realYield"), dollar: base("dollar"), yields: base("yields"), riskSentiment: base("riskSentiment"), momentum: base("momentum") };
};

async function main(): Promise<void> {
  console.log("validate-macro-alignment\n");

  await test("weights sum to 100", () => assert.equal(TOTAL_WEIGHT, 100));

  await test("all five drivers favour gold -> 100% supportive", () => {
    const a = computeMacroAlignment(mk({ realYield: -0.2, dollar: -0.5, yields: 0.4, riskSentiment: 5, momentum: 0.9 }));
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 100);
    assert.equal(a.label, "Supports gold");
    assert.equal(a.availableDrivers, 5);
  });

  await test("all five against gold -> 100% headwind", () => {
    const a = computeMacroAlignment(mk({ realYield: 0.3, dollar: 0.6, yields: -0.5, riskSentiment: -9, momentum: -1 }));
    // risk sentiment never counts against gold (calm = neutral): 90 of 100
    assert.equal(a.lean, "headwind");
    assert.equal(a.score, 90);
  });

  await test("score = share of available weight agreeing with the lean (hand-checked)", () => {
    // realYield +1 (30), dollar +1 (20), yields -1 (15), risk 0 (10), momentum +1 (25) -> net 60, agree 75/100
    const a = computeMacroAlignment(mk({ realYield: -0.1, dollar: -0.2, yields: -0.3, riskSentiment: 0, momentum: 0.5 }));
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 75);
  });

  await test("moves inside the noise threshold read neutral", () => {
    const a = computeMacroAlignment(mk({ realYield: 0.01, dollar: 0.05, yields: -0.05, riskSentiment: 0.5, momentum: 0.1 }));
    assert.ok(a.drivers.every((d) => d.sign === 0));
    assert.equal(a.lean, "mixed");
  });

  await test("a lean backed by under half the weight is reported Mixed, not a conviction", () => {
    // realYield +1 (30) vs dollar -1 (20), yields -1 (15), momentum -1 (25)... net negative, agree 60 -> headwind; flip it:
    const a = computeMacroAlignment(mk({ realYield: -0.2, dollar: 0.3, yields: -0.3, riskSentiment: 0, momentum: 0.1 }));
    // +30 (rY) -20 -15 = -5 -> headwind, agreeing weight 35 of 100 -> <50 -> Mixed
    assert.equal(a.lean, "mixed");
    assert.equal(a.label, "Mixed");
    assert.equal(a.score, 35);
  });

  await test("missing data is never guessed: unavailable drivers drop out and are labelled", () => {
    const a = computeMacroAlignment(mk({ dollar: -0.5, yields: 0.4, momentum: 0.9 }));
    assert.equal(a.availableDrivers, 3);
    assert.equal(a.score, 100);
    const ry = a.drivers.find((d) => d.id === "realYield")!;
    assert.equal(ry.available, false);
    assert.equal(ry.detail, "Data not available right now");
  });

  await test(`fewer than ${MIN_DRIVERS} drivers -> no score at all`, () => {
    const a = computeMacroAlignment(mk({ dollar: -0.5, momentum: 0.9 }));
    assert.equal(a.lean, "insufficient");
    assert.equal(a.score, null);
    assert.equal(alignmentLine(a), "Macro alignment: not enough data right now");
  });

  await test("deterministic: same inputs -> identical output", () => {
    const i = mk({ realYield: -0.1, dollar: -0.2, yields: 0.3, riskSentiment: 3, momentum: 0.5 });
    assert.deepEqual(computeMacroAlignment(i), computeMacroAlignment(i));
  });

  await test("formula and caveat are always attached; no trade instruction or probability claim", () => {
    const a = computeMacroAlignment(mk({ realYield: -0.2, dollar: -0.5, yields: 0.4 }));
    assert.match(a.caveat, /not a forecast/i);
    assert.match(a.formula, /share of total driver weight/i);
    const text = JSON.stringify(a).toLowerCase();
    assert.ok(!/\b(buy|sell|probability)\b/.test(text.replace(/not a forecast/g, "")));
  });

  // ── data layer ──
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
  const goodFetch: FetchLike = async (url) => {
    if (url.includes("api.stlouisfed.org")) {
      const vals = [2.87, 2.9, 2.92, 2.95, 2.98, 3.02, 3.0, 3.0, 3.0, 3.0];
      return json({ observations: vals.map((v, i) => ({ date: `2026-10-${String(9 - i).padStart(2, "0")}`, value: String(v) })) });
    }
    const sym = decodeURIComponent(new URL(url).searchParams.get("symbol") ?? "");
    const pct: Record<string, string> = { "XAU/USD": "0.40", UUP: "-0.30", IEF: "0.20", VIXY: "-1.50" };
    return json({ symbol: sym, close: sym === "XAU/USD" ? "4166.14" : "29.1", percent_change: pct[sym], last_quote_at: 1791815280 });
  };

  await test("fetch: all sources up -> five readings, real-yield change vs 5 obs earlier", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, goodFetch, { noCache: true });
    assert.ok(Math.abs((r.inputs.realYield.value ?? 0) - (2.87 - 3.02)) < 1e-9);
    assert.equal(r.inputs.dollar.value, -0.3);
    assert.equal(r.inputs.momentum.value, 0.4);
    assert.deepEqual(r.gold, { price: 4166.14, changePct: 0.4 });
    const a = computeMacroAlignment(r.inputs);
    assert.equal(a.availableDrivers, 5);
    assert.equal(a.lean, "supportive");
  });

  await test("fetch: no FRED key -> real yield unavailable (not estimated), rest still scored", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, goodFetch, { noCache: true });
    assert.equal(r.inputs.realYield.value, null);
    assert.equal(computeMacroAlignment(r.inputs).availableDrivers, 4);
  });

  await test("fetch: a throwing / erroring provider degrades to null, never throws", async () => {
    resetMacroCacheForTests();
    const bad: FetchLike = async (url) => {
      if (url.includes("stlouisfed")) throw new Error("network");
      return json({ code: 404, status: "error", message: "nope" });
    };
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, bad, { noCache: true });
    assert.ok(Object.values(r.inputs).every((i) => i.value === null));
    assert.equal(r.gold, null);
    assert.equal(computeMacroAlignment(r.inputs).lean, "insufficient");
  });

  await test("fetch: no keys at all -> everything unavailable, no network call", async () => {
    resetMacroCacheForTests();
    let calls = 0;
    const r = await fetchMacroInputs({ twelveDataKey: null, fredKey: null }, async () => (calls += 1, json({})), { noCache: true });
    assert.equal(calls, 0);
    assert.ok(Object.values(r.inputs).every((i) => i.value === null));
  });

  await test("fetch: result is cached (second call makes no requests)", async () => {
    resetMacroCacheForTests();
    let calls = 0;
    const counting: FetchLike = async (u) => (calls += 1, goodFetch(u));
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting);
    const first = calls;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting);
    assert.equal(calls, first);
    resetMacroCacheForTests();
  });

  // ── brief extras ──
  await test("IST date key and countdown", () => {
    assert.equal(istDateKey(new Date("2026-10-12T20:00:00Z")), "2026-10-13"); // 01:30 IST next day
    assert.equal(istDateKey(new Date("2026-10-12T02:30:00Z")), "2026-10-12");
    assert.equal(countdown(3 * 3600000 + 20 * 60000), "in 3h 20m");
    assert.equal(countdown(45 * 60000), "in 45m");
    assert.equal(countdown(-1000), "now");
  });

  await test("events: only TODAY (IST), high impact, not holidays, not past, soonest first, with forecast/previous", () => {
    const now = new Date("2026-10-12T02:30:00Z"); // 08:00 IST
    const ev = [
      { title: "CPI", currency: "USD", impact: "high", eventTime: "2026-10-12T12:30:00Z", forecast: "3.1%", previous: "3.0%" }, // 18:00 IST
      { title: "Fed Speaks", currency: "USD", impact: "high", eventTime: "2026-10-12T09:00:00Z" }, // 14:30 IST
      { title: "Tomorrow NFP", currency: "USD", impact: "high", eventTime: "2026-10-13T12:30:00Z" },
      { title: "Low thing", currency: "USD", impact: "low", eventTime: "2026-10-12T10:00:00Z" },
      { title: "Bank Holiday", currency: "USD", impact: "high", isHoliday: true, eventTime: "2026-10-12T10:00:00Z" },
      { title: "Already gone", currency: "USD", impact: "high", eventTime: "2026-10-12T01:00:00Z" },
    ];
    const lines = formatEventLines(ev, now);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "14:30 IST (in 6h 30m) - USD Fed Speaks");
    assert.equal(lines[1], "18:00 IST (in 10h 0m) - USD CPI [forecast 3.1%, previous 3.0%]");
  });

  await test("price line", () => {
    assert.equal(formatPriceLine({ price: 4166.14, changePct: 0.4 }), "Gold $4,166.14 (+0.40% today)");
    assert.equal(formatPriceLine({ price: 4000, changePct: -1.234 }), "Gold $4,000 (-1.23% today)");
    assert.equal(formatPriceLine(null), undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
