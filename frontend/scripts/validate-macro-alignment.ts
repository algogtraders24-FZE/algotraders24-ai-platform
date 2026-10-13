// scripts/validate-macro-alignment.ts
// AT24 Macro Alignment (gold) - scoring, data fetch and brief-extras formatters.
// Pure/in-memory: every network call is an injected fake. `npm run validate:macro-alignment`.

import assert from "node:assert/strict";
import { computeMacroAlignment, alignmentLine, ASSET_PROFILES, ASSET_IDS, MIN_DRIVERS, isAssetId, profileForMiSymbol, profileTotalWeight, type MacroInputs, type DriverId } from "../services/macro/macro-alignment";
import { formatMacroPrice } from "../services/macro/macro-service";
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

const IDS: DriverId[] = ["realYield", "nominalYield", "dollar", "yields", "riskAppetite", "riskSentiment", "momentum"];
const mk = (v: Partial<Record<DriverId, number | null>>): MacroInputs => {
  const out: MacroInputs = {};
  for (const id of IDS) out[id] = { value: v[id] ?? null, unit: "u", source: `src-${id}`, asOf: null };
  return out;
};

async function main(): Promise<void> {
  console.log("validate-macro-alignment\n");

  await test("every asset profile: weights sum to 100, has a momentum driver, names what it does not cover", () => {
    for (const id of ASSET_IDS) {
      const p = ASSET_PROFILES[id];
      assert.equal(profileTotalWeight(p), 100, id);
      assert.ok(p.drivers.some((d) => d.id === "momentum"), id);
      assert.ok(p.notCovered.length > 0, id);
      assert.ok(p.drivers.length >= MIN_DRIVERS, id);
      assert.equal(new Set(p.drivers.map((d) => d.id)).size, p.drivers.length, `${id} duplicate drivers`);
    }
  });

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
    const pct: Record<string, string> = { "XAU/USD": "0.40", UUP: "-0.30", IEF: "0.20", VIXY: "-1.50", QQQ: "0.80", "EUR/USD": "0.25", "USD/JPY": "0.35", "BTC/USD": "2.50", USO: "1.90" };
    return json({ symbol: sym, close: sym === "XAU/USD" ? "4166.14" : "29.1", percent_change: pct[sym], last_quote_at: 1791815280 });
  };

  await test("fetch: all sources up -> five readings, real-yield change vs 5 obs earlier", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, goodFetch, ASSET_PROFILES.gold, { noCache: true });
    assert.ok(Math.abs((r.inputs.realYield?.value ?? 0) - (2.87 - 3.02)) < 1e-9);
    assert.equal(r.inputs.dollar?.value, -0.3);
    assert.equal(r.inputs.momentum?.value, 0.4);
    assert.deepEqual(r.own, { price: 4166.14, changePct: 0.4 });
    const a = computeMacroAlignment(r.inputs);
    assert.equal(a.availableDrivers, 5);
    assert.equal(a.lean, "supportive");
  });

  await test("fetch: no FRED key -> real yield unavailable (not estimated), rest still scored", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, goodFetch, ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.realYield?.value, null);
    assert.equal(computeMacroAlignment(r.inputs).availableDrivers, 4);
  });

  await test("fetch: a throwing / erroring provider degrades to null, never throws", async () => {
    resetMacroCacheForTests();
    const bad: FetchLike = async (url) => {
      if (url.includes("stlouisfed")) throw new Error("network");
      return json({ code: 404, status: "error", message: "nope" });
    };
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, bad, ASSET_PROFILES.gold, { noCache: true });
    assert.ok(Object.values(r.inputs).every((i) => i.value === null));
    assert.equal(r.own, null);
    assert.equal(computeMacroAlignment(r.inputs).lean, "insufficient");
  });

  await test("fetch: no keys at all -> everything unavailable, no network call", async () => {
    resetMacroCacheForTests();
    let calls = 0;
    const r = await fetchMacroInputs({ twelveDataKey: null, fredKey: null }, async () => (calls += 1, json({})), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(calls, 0);
    assert.ok(Object.values(r.inputs).every((i) => i.value === null));
  });

  await test("fetch: result is cached (second call makes no requests)", async () => {
    resetMacroCacheForTests();
    let calls = 0;
    const counting: FetchLike = async (u) => (calls += 1, goodFetch(u));
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting, ASSET_PROFILES.gold);
    const first = calls;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting, ASSET_PROFILES.gold);
    assert.equal(calls, first);
    resetMacroCacheForTests();
  });

  // ── other assets ──
  await test("EUR/USD: weaker dollar + bid Treasuries + risk-on + EUR up -> supportive", () => {
    const a = computeMacroAlignment(mk({ dollar: -0.4, yields: 0.3, riskAppetite: 0.9, riskSentiment: -2, momentum: 0.5 }), ASSET_PROFILES.eurusd);
    assert.equal(a.asset, "eurusd");
    assert.equal(a.lean, "supportive");
    assert.equal(a.label, "Supports EUR/USD");
    assert.ok(a.score !== null && a.score >= 90);
  });

  await test("USD/JPY: rising US yields (FRED) + falling Treasuries + risk-on -> supports USD/JPY", () => {
    const a = computeMacroAlignment(mk({ nominalYield: 0.2, yields: -0.4, riskAppetite: 0.8, riskSentiment: 0, momentum: 0.4 }), ASSET_PROFILES.usdjpy);
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 90); // everything but the neutral volatility driver (weight 10)
    assert.ok(a.drivers.find((d) => d.id === "nominalYield")!.detail.includes("US 10Y yield rising"));
  });

  await test("a volatility spike (risk-off) is a HEADWIND for USD/JPY and Bitcoin, support for gold", () => {
    const sign = (p: keyof typeof ASSET_PROFILES) => computeMacroAlignment(mk({ riskSentiment: 5 }), ASSET_PROFILES[p]).drivers.find((d) => d.id === "riskSentiment")!.sign;
    assert.equal(sign("gold"), 1);
    assert.equal(sign("usdjpy"), -1);
    assert.equal(sign("btcusd"), -1);
  });

  await test("Bitcoin: needs a bigger move (1%) before momentum counts; 0.5% is noise", () => {
    assert.equal(computeMacroAlignment(mk({ momentum: 0.5 }), ASSET_PROFILES.btcusd).drivers.find((d) => d.id === "momentum")!.sign, 0);
    assert.equal(computeMacroAlignment(mk({ momentum: 2.3 }), ASSET_PROFILES.btcusd).drivers.find((d) => d.id === "momentum")!.sign, 1);
  });

  await test("Bitcoin: risk-off + stronger dollar + rising real yield -> headwind", () => {
    const a = computeMacroAlignment(mk({ riskAppetite: -1.2, dollar: 0.4, realYield: 0.1, riskSentiment: 6, momentum: -2 }), ASSET_PROFILES.btcusd);
    assert.equal(a.lean, "headwind");
    assert.equal(a.score, 100);
    assert.equal(a.label, "Headwind for Bitcoin");
  });

  await test("Crude oil: scored from 4 drivers and says what it does NOT cover (inventories / OPEC / proxy)", () => {
    const a = computeMacroAlignment(mk({ dollar: -0.3, riskAppetite: 0.6, riskSentiment: 0, momentum: 1.4 }), ASSET_PROFILES.oil);
    assert.equal(a.totalDrivers, 4);
    assert.equal(a.lean, "supportive");
    assert.ok(a.notCovered.some((n) => /inventories|OPEC/.test(n)));
    assert.ok(a.notCovered.some((n) => /proxy/i.test(n)));
    assert.equal(ASSET_PROFILES.oil.miSymbol, null);
  });

  await test("a driver this asset does not use is ignored even if supplied", () => {
    const a = computeMacroAlignment(mk({ realYield: -0.5, dollar: -0.4, riskAppetite: 0.9, riskSentiment: 0, momentum: 2 }), ASSET_PROFILES.oil);
    assert.ok(!a.drivers.some((d) => d.id === "realYield"));
  });

  await test("fetch per asset: only the sources that asset needs are requested", async () => {
    const urls: string[] = [];
    const spyFetch: FetchLike = async (u) => (urls.push(u), goodFetch(u));
    resetMacroCacheForTests();
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, spyFetch, ASSET_PROFILES.usdjpy, { noCache: true });
    const syms = urls.filter((u) => u.includes("twelvedata")).map((u) => decodeURIComponent(new URL(u).searchParams.get("symbol") ?? "")).sort();
    assert.deepEqual(syms, ["IEF", "QQQ", "USD/JPY", "VIXY"]);
    assert.ok(urls.some((u) => u.includes("series_id=DGS10")));
    assert.ok(!urls.some((u) => u.includes("series_id=DFII10")));
  });

  await test("fetch Bitcoin end-to-end (fakes) -> 5 drivers, real yield from FRED", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, goodFetch, ASSET_PROFILES.btcusd, { noCache: true });
    const a = computeMacroAlignment(r.inputs, ASSET_PROFILES.btcusd);
    assert.equal(a.availableDrivers, 5);
    assert.equal(r.own?.changePct, 2.5);
  });

  await test("switching asset reuses cached shared quotes (only QQQ and the asset itself are new for EUR/USD after gold)", async () => {
    resetMacroCacheForTests();
    const urls: string[] = [];
    const counting: FetchLike = async (u) => (urls.push(u), goodFetch(u));
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting, ASSET_PROFILES.gold);
    const afterGold = urls.length;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, counting, ASSET_PROFILES.eurusd);
    assert.equal(urls.length - afterGold, 2);
    resetMacroCacheForTests();
  });

  await test("a failed quote is remembered only briefly (outage heals), not for 5 minutes", async () => {
    resetMacroCacheForTests();
    let fail = true;
    const flaky: FetchLike = async (u) => (fail ? json({ code: 429, status: "error" }) : goodFetch(u));
    const first = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, flaky, ASSET_PROFILES.gold);
    assert.equal(first.inputs.dollar?.value, null);
    fail = false;
    const again = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, flaky, ASSET_PROFILES.gold);
    assert.equal(again.inputs.dollar?.value, null, "still inside the 60s failure window");
    resetMacroCacheForTests();
    const healed = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, flaky, ASSET_PROFILES.gold);
    assert.equal(healed.inputs.dollar?.value, -0.3);
  });

  await test("moves inside the noise band are worded as 'little changed', never as a direction", () => {
    const a = computeMacroAlignment(mk({ yields: 0.03, dollar: 0.05, riskAppetite: -0.1, momentum: 0.05 }), ASSET_PROFILES.eurusd);
    const text = a.drivers.filter((d) => d.available).map((d) => d.detail).join(" | ");
    assert.ok(!/bid|sold|stronger|weaker|rising|falling| up | down /.test(text), text);
    assert.equal((text.match(/little changed/g) ?? []).length, 4);
  });

  await test("asset id validation + MI symbol lookup", () => {
    assert.ok(isAssetId("btcusd") && !isAssetId("doge") && !isAssetId(""));
    assert.equal(profileForMiSymbol("XAUUSD")?.id, "gold");
    assert.equal(profileForMiSymbol("EURUSD")?.id, "eurusd");
    assert.equal(profileForMiSymbol("SOLUSD"), null);
    assert.deepEqual(ASSET_PROFILES.eurusd.calendarCurrencies, ["USD", "EUR"]);
  });

  await test("price formatting per asset", () => {
    assert.equal(formatMacroPrice("gold", 4166.145), "$4,166.15");
    assert.equal(formatMacroPrice("eurusd", 1.11784), "1.1178");
    assert.equal(formatMacroPrice("usdjpy", 158.257), "158.26");
    assert.equal(formatMacroPrice("btcusd", 83706.41), "$83,706");
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
    assert.equal(formatPriceLine({ label: "Gold", text: "$4,166.14", changePct: 0.4 }), "Gold $4,166.14 (+0.40% today)");
    assert.equal(formatPriceLine({ label: "EUR/USD", text: "1.1178", changePct: -1.234 }), "EUR/USD 1.1178 (-1.23% today)");
    assert.equal(formatPriceLine(null), undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
