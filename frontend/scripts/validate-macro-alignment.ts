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

const IDS: DriverId[] = ["realYield", "nominalYield", "dollar", "yields", "riskAppetite", "riskBarometer", "momentum"];
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
    const a = computeMacroAlignment(mk({ realYield: -0.2, dollar: -0.5, yields: 0.4, riskBarometer: -0.8, momentum: 0.9 }));
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 100);
    assert.equal(a.label, "Supports gold");
    assert.equal(a.availableDrivers, 5);
  });

  await test("all five against gold -> 100% headwind", () => {
    const a = computeMacroAlignment(mk({ realYield: 0.3, dollar: 0.6, yields: -0.5, riskBarometer: 0.5, momentum: -1 }));
    // risk sentiment never counts against gold (calm = neutral): 90 of 100
    assert.equal(a.lean, "headwind");
    assert.equal(a.score, 90);
  });

  await test("score = share of available weight agreeing with the lean (hand-checked)", () => {
    // realYield +1 (30), dollar +1 (20), yields -1 (15), risk 0 (10), momentum +1 (25) -> net 60, agree 75/100
    const a = computeMacroAlignment(mk({ realYield: -0.1, dollar: -0.2, yields: -0.3, riskBarometer: 0, momentum: 0.5 }));
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 75);
  });

  await test("moves inside the noise threshold read neutral", () => {
    const a = computeMacroAlignment(mk({ realYield: 0.01, dollar: 0.05, yields: -0.05, riskBarometer: 0.1, momentum: 0.1 }));
    assert.ok(a.drivers.every((d) => d.sign === 0));
    assert.equal(a.lean, "mixed");
  });

  await test("a lean backed by under half the weight is reported Mixed, not a conviction", () => {
    // realYield +1 (30) vs dollar -1 (20), yields -1 (15), momentum -1 (25)... net negative, agree 60 -> headwind; flip it:
    const a = computeMacroAlignment(mk({ realYield: -0.2, dollar: 0.3, yields: -0.3, riskBarometer: 0, momentum: 0.1 }));
    // +30 (rY) -20 -15 = -5 -> headwind, agreeing weight 35 of 100 -> <50 -> Mixed
    assert.equal(a.lean, "mixed");
    assert.equal(a.label, "Mixed");
    assert.equal(a.score, 35);
  });

  await test("missing data is never guessed: unavailable drivers drop out and are labelled", () => {
    const a = computeMacroAlignment(mk({ dollar: -0.5, yields: 0.4, riskBarometer: -0.8, momentum: 0.9 }));
    assert.equal(a.availableDrivers, 4);
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
    const i = mk({ realYield: -0.1, dollar: -0.2, yields: 0.3, riskBarometer: -0.8, momentum: 0.5 });
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
    const pct: Record<string, string> = { "XAU/USD": "0.40", UUP: "-0.30", IEF: "0.20", QQQ: "0.80", "EUR/USD": "0.25", "USD/JPY": "0.35", "BTC/USD": "2.50", USO: "1.90" };
    return json({ symbol: sym, close: sym === "XAU/USD" ? "4166.14" : "29.1", percent_change: pct[sym], last_quote_at: 1791815280 });
  };

  await test("fetch: all sources up -> real-yield change vs 5 obs earlier (4 of 5 drivers - barometer is MT5-only), real-yield change vs 5 obs earlier", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, goodFetch, ASSET_PROFILES.gold, { noCache: true });
    assert.ok(Math.abs((r.inputs.realYield?.value ?? 0) - (2.87 - 3.02)) < 1e-9);
    assert.equal(r.inputs.dollar?.value, -0.3);
    assert.equal(r.inputs.momentum?.value, 0.4);
    assert.deepEqual(r.own, { price: 4166.14, changePct: 0.4, provider: "twelve-data" });
    const a = computeMacroAlignment(r.inputs);
    assert.equal(a.availableDrivers, 4); // the risk barometer is MT5-only
    assert.equal(a.lean, "supportive");
  });

  await test("fetch: no FRED key -> real yield unavailable (not estimated), rest still scored", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, goodFetch, ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.realYield?.value, null);
    assert.equal(computeMacroAlignment(r.inputs).availableDrivers, 3);
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
    const a = computeMacroAlignment(mk({ dollar: -0.4, yields: 0.3, riskAppetite: 0.9, riskBarometer: 0.3, momentum: 0.5 }), ASSET_PROFILES.eurusd);
    assert.equal(a.asset, "eurusd");
    assert.equal(a.lean, "supportive");
    assert.equal(a.label, "Supports EUR/USD");
    assert.ok(a.score !== null && a.score >= 90);
  });

  await test("USD/JPY: rising US yields (FRED) + falling Treasuries + risk-on -> supports USD/JPY", () => {
    const a = computeMacroAlignment(mk({ nominalYield: 0.2, yields: -0.4, riskAppetite: 0.8, riskBarometer: 0, momentum: 0.4 }), ASSET_PROFILES.usdjpy);
    assert.equal(a.lean, "supportive");
    assert.equal(a.score, 90); // everything but the neutral risk-barometer driver (weight 10)
    assert.ok(a.drivers.find((d) => d.id === "nominalYield")!.detail.includes("US 10Y yield rising"));
  });

  await test("risk-off (AUD/JPY falling) is a HEADWIND for USD/JPY and Bitcoin, support for gold; risk-on is neutral for all", () => {
    const sign = (p: keyof typeof ASSET_PROFILES, v = -0.8) => computeMacroAlignment(mk({ riskBarometer: v }), ASSET_PROFILES[p]).drivers.find((d) => d.id === "riskBarometer")!.sign;
    assert.equal(sign("gold", 0.8), 0);
    assert.equal(sign("btcusd", 0.8), 0);
    assert.equal(sign("gold"), 1);
    assert.equal(sign("usdjpy"), -1);
    assert.equal(sign("btcusd"), -1);
  });

  await test("Bitcoin: needs a bigger move (1%) before momentum counts; 0.5% is noise", () => {
    assert.equal(computeMacroAlignment(mk({ momentum: 0.5 }), ASSET_PROFILES.btcusd).drivers.find((d) => d.id === "momentum")!.sign, 0);
    assert.equal(computeMacroAlignment(mk({ momentum: 2.3 }), ASSET_PROFILES.btcusd).drivers.find((d) => d.id === "momentum")!.sign, 1);
  });

  await test("Bitcoin: risk-off + stronger dollar + rising real yield -> headwind", () => {
    const a = computeMacroAlignment(mk({ riskAppetite: -1.2, dollar: 0.4, realYield: 0.1, riskBarometer: -0.8, momentum: -2 }), ASSET_PROFILES.btcusd);
    assert.equal(a.lean, "headwind");
    assert.equal(a.score, 100);
    assert.equal(a.label, "Headwind for Bitcoin");
  });

  await test("Crude oil: scored from 4 drivers and says what it does NOT cover (inventories / OPEC / proxy)", () => {
    const a = computeMacroAlignment(mk({ dollar: -0.3, riskAppetite: 0.6, riskBarometer: 0, momentum: 1.4 }), ASSET_PROFILES.oil);
    assert.equal(a.totalDrivers, 4);
    assert.equal(a.lean, "supportive");
    assert.ok(a.notCovered.some((n) => /inventories|OPEC/.test(n)));
    assert.ok(a.notCovered.some((n) => /proxy/i.test(n)));
    assert.equal(ASSET_PROFILES.oil.miSymbol, null);
  });

  await test("a driver this asset does not use is ignored even if supplied", () => {
    const a = computeMacroAlignment(mk({ realYield: -0.5, dollar: -0.4, riskAppetite: 0.9, riskBarometer: 0, momentum: 2 }), ASSET_PROFILES.oil);
    assert.ok(!a.drivers.some((d) => d.id === "realYield"));
  });

  await test("fetch per asset: only the sources that asset needs are requested", async () => {
    const urls: string[] = [];
    const spyFetch: FetchLike = async (u) => (urls.push(u), goodFetch(u));
    resetMacroCacheForTests();
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, spyFetch, ASSET_PROFILES.usdjpy, { noCache: true });
    const syms = urls.filter((u) => u.includes("twelvedata")).map((u) => decodeURIComponent(new URL(u).searchParams.get("symbol") ?? "")).sort();
    assert.deepEqual(syms, ["IEF", "QQQ", "USD/JPY"]); // no bridge here: USD/JPY falls back to QQQ, the risk barometer is MT5-only
    assert.ok(urls.some((u) => u.includes("series_id=DGS10")));
    assert.ok(!urls.some((u) => u.includes("series_id=DFII10")));
  });

  await test("fetch Bitcoin end-to-end (fakes) -> 4 drivers, real yield from FRED", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f" }, goodFetch, ASSET_PROFILES.btcusd, { noCache: true });
    const a = computeMacroAlignment(r.inputs, ASSET_PROFILES.btcusd);
    assert.equal(a.availableDrivers, 4);
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

  await test("coverage rule: a verdict needs >= 70% of the asset's weight; oil without its own price gets no score", () => {
    // oil: dollar 25 + stocks 25 + vol 10 = 60% of the weight, momentum (40) missing
    const oil = computeMacroAlignment(mk({ dollar: 0.4, riskAppetite: -1, riskBarometer: 0 }), ASSET_PROFILES.oil);
    assert.equal(oil.lean, "insufficient");
    assert.equal(oil.score, null);
    // gold without real yield (30%) is exactly 70% -> still scored
    const gold = computeMacroAlignment(mk({ dollar: -0.5, yields: 0.4, riskBarometer: -0.8, momentum: 0.9 }), ASSET_PROFILES.gold);
    assert.equal(gold.lean, "supportive");
    // gold missing real yield AND momentum (55%) -> no score
    assert.equal(computeMacroAlignment(mk({ dollar: -0.5, yields: 0.4, riskBarometer: -0.8 }), ASSET_PROFILES.gold).lean, "insufficient");
    // USD/JPY without the FRED 10Y (30%) -> 70%, scored
    assert.notEqual(computeMacroAlignment(mk({ yields: -0.4, riskAppetite: 0.8, riskBarometer: 0, momentum: 0.4 }), ASSET_PROFILES.usdjpy).lean, "insufficient");
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

  // ── MT5 (Exness) first, Twelve Data fallback ──
  const MT5 = { bridgeUrl: "https://bridge.test", secret: "bridge-secret" };
  // previous daily close -> forming day's price; pct = (last - prev) / prev * 100
  const CANDLES: Record<string, [number, number]> = {
    XAUUSD: [4000, 4040], // +1.00%
    XAGUSD: [60, 60.6], // +1.00%
    EURUSD: [1.1, 1.1022], // +0.20%
    GBPUSD: [1.3, 1.3026],
    USDJPY: [158, 158.316],
    BTCUSD: [80000, 81600], // +2.00%
    ETHUSD: [2500, 2550],
    DXY: [100, 99.7], // -0.30%
    USTEC: [20000, 20160], // +0.80%
    USOIL: [90, 91.8], // +2.00%
    DE30: [18000, 18036], // +0.20%
    JP225: [40000, 39600], // -1.00%
    AUDJPY: [100, 99.5], // -0.50% (risk-off)
    XCUUSD: [4, 4.04], // +1.00%
  };
  const bridgeCalls: { url: string; auth: string | undefined }[] = [];
  const mt5Fetch =
    (opts: { missing?: string[]; down?: boolean; oneCandle?: string[]; stale?: string[] } = {}): FetchLike =>
    async (url, init) => {
      if (!url.startsWith(MT5.bridgeUrl)) return goodFetch(url);
      bridgeCalls.push({ url, auth: init?.headers?.Authorization });
      if (opts.down) throw new Error("bridge down");
      const sym = new URL(url).searchParams.get("symbol") ?? "";
      if (opts.missing?.includes(sym) || !CANDLES[sym]) return { ok: false, status: 404, json: async () => ({}) };
      const [prev, last] = CANDLES[sym];
      // candle times are relative to "now" so the test never ages out; a stale symbol answers with a year-old candle
      const day = 24 * 3600 * 1000;
      const lastAt = opts.stale?.includes(sym) ? Date.now() - 365 * day : Date.now() - 3600 * 1000;
      const candles = opts.oneCandle?.includes(sym)
        ? [{ datetime: new Date(lastAt).toISOString(), close: last }]
        : [{ datetime: new Date(lastAt - day).toISOString(), close: prev }, { datetime: new Date(lastAt).toISOString(), close: last }];
      return json({ symbol: sym, interval: "1d", candles });
    };
  const tdSymbols = (urls: string[]) => urls.filter((u) => u.includes("twelvedata")).map((u) => decodeURIComponent(new URL(u).searchParams.get("symbol") ?? "")).sort();

  await test("MT5 first: gold's own price + day change come from the Exness candles; DXY replaces UUP; Twelve Data only for IEF", async () => {
    resetMacroCacheForTests();
    const urls: string[] = [];
    const f: FetchLike = async (u, i) => (urls.push(u), mt5Fetch()(u, i));
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, f, ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.momentum?.value, 1);
    assert.equal(r.inputs.momentum?.source, "XAUUSD (Exness)");
    assert.deepEqual(r.own, { price: 4040, changePct: 1, provider: "mt5" });
    assert.equal(r.inputs.dollar?.source, "DXY (US dollar index, Exness)");
    assert.ok(Math.abs((r.inputs.dollar?.value ?? 0) - -0.3) < 1e-9);
    assert.deepEqual(tdSymbols(urls), ["IEF"]);
    assert.equal(r.inputs.riskBarometer?.source, "AUDJPY (risk barometer, Exness)");
    assert.ok(Math.abs((r.inputs.riskBarometer?.value ?? 0) - -0.5) < 1e-9);
  });

  await test("MT5 first: EUR/USD takes DXY (dollar) and DAX 40 (stocks) from Exness; Twelve Data only IEF", async () => {
    resetMacroCacheForTests();
    const urls: string[] = [];
    const f: FetchLike = async (u, i) => (urls.push(u), mt5Fetch()(u, i));
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, f, ASSET_PROFILES.eurusd, { noCache: true });
    assert.equal(r.inputs.riskAppetite?.source, "DE30 (DAX 40, Exness)");
    assert.ok(Math.abs((r.inputs.riskAppetite?.value ?? 0) - 0.2) < 1e-9);
    assert.equal(r.inputs.dollar?.source, "DXY (US dollar index, Exness)");
    assert.deepEqual(tdSymbols(urls), ["IEF"]);
  });

  await test("MT5 first: real silver (XAGUSD) and real WTI (USOIL) replace the SLV / USO proxies", async () => {
    resetMacroCacheForTests();
    const silver = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.silver, { noCache: true });
    assert.equal(silver.inputs.momentum?.source, "XAGUSD (Exness)");
    assert.equal(silver.own?.provider, "mt5");
    const oil = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.oil, { noCache: true });
    assert.equal(oil.inputs.momentum?.source, "USOIL (Exness)");
    assert.ok(Math.abs((oil.inputs.momentum?.value ?? 0) - 2) < 1e-9);
  });

  await test("regional risk index: USD/JPY uses the Nikkei (JP225), GBP/USD and Bitcoin the Nasdaq-100 (USTEC)", async () => {
    resetMacroCacheForTests();
    const jpy = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.usdjpy, { noCache: true });
    assert.equal(jpy.inputs.riskAppetite?.source, "JP225 (Nikkei 225, Exness)");
    assert.ok(Math.abs((jpy.inputs.riskAppetite?.value ?? 0) - -1) < 1e-9);
    const gbp = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.gbpusd, { noCache: true });
    assert.equal(gbp.inputs.riskAppetite?.source, "USTEC (Nasdaq-100, Exness)");
  });

  await test("a stale MT5 reading (last candle a year old, as AUDJPY showed) is treated as unavailable, never used as today's move", async () => {
    resetMacroCacheForTests();
    // barometer is MT5-only: stale -> driver unavailable
    const g = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ stale: ["AUDJPY"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(g.inputs.riskBarometer?.value, null);
    // a stale DXY falls back to the UUP proxy (labelled), not to the old candle
    resetMacroCacheForTests();
    const d = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ stale: ["DXY"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(d.inputs.dollar?.source, "UUP (dollar proxy)");
    // a stale own quote falls back to Twelve Data
    resetMacroCacheForTests();
    const o = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ stale: ["XAUUSD"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(o.own?.provider, "twelve-data");
    // a weekend-old candle (3 days) is still current
    resetMacroCacheForTests();
    const fresh = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(fresh.own?.provider, "mt5");
  });

  await test("risk barometer is MT5-only: when the bridge lacks AUDJPY the driver is unavailable (no ETF substitute is invented)", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ missing: ["AUDJPY"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.riskBarometer?.value, null);
    assert.equal(r.inputs.riskBarometer?.source, "AUDJPY (risk barometer, Exness)");
    assert.equal(computeMacroAlignment(r.inputs, ASSET_PROFILES.gold).availableDrivers, 4);
  });

  await test("copper: scored from the Exness feed only; without the bridge it says not enough data", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.copper, { noCache: true });
    assert.equal(r.inputs.momentum?.source, "XCUUSD (Exness)");
    assert.equal(r.own?.provider, "mt5");
    const a = computeMacroAlignment(r.inputs, ASSET_PROFILES.copper);
    assert.equal(a.totalDrivers, 4);
    assert.notEqual(a.lean, "insufficient");
    resetMacroCacheForTests();
    const none = await fetchMacroInputs({ twelveDataKey: "k", fredKey: null }, goodFetch, ASSET_PROFILES.copper, { noCache: true });
    assert.equal(computeMacroAlignment(none.inputs, ASSET_PROFILES.copper).lean, "insufficient");
  });

  await test("fallback: a symbol the bridge does not map yet (404) falls back to the Twelve Data proxy, labelled as such", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ missing: ["DXY"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.dollar?.source, "UUP (dollar proxy)");
    assert.equal(r.inputs.dollar?.value, -0.3);
    assert.equal(r.inputs.momentum?.source, "XAUUSD (Exness)"); // the rest still comes from MT5
  });

  await test("fallback: bridge down -> everything from Twelve Data, nothing throws", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ down: true }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.own?.provider, "twelve-data");
    assert.equal(r.inputs.momentum?.source, "XAU/USD");
    assert.equal(computeMacroAlignment(r.inputs, ASSET_PROFILES.gold).availableDrivers, 4);
  });

  await test("a single daily candle has no previous close -> no day change from MT5, falls back (never a fake 0%)", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: "k", fredKey: "f", mt5: MT5 }, mt5Fetch({ oneCandle: ["XAUUSD"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.own?.provider, "twelve-data");
  });

  await test("no Twelve Data key and the bridge missing a symbol -> that driver is unavailable, not guessed", async () => {
    resetMacroCacheForTests();
    const r = await fetchMacroInputs({ twelveDataKey: null, fredKey: null, mt5: MT5 }, mt5Fetch({ missing: ["DXY"] }), ASSET_PROFILES.gold, { noCache: true });
    assert.equal(r.inputs.dollar?.value, null);
    assert.equal(r.inputs.momentum?.value, 1);
  });

  await test("the bridge is called read-only: GET /candles with the Bearer secret and the 1d interval", async () => {
    resetMacroCacheForTests();
    bridgeCalls.length = 0;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.gold, { noCache: true });
    assert.ok(bridgeCalls.length >= 2);
    for (const c of bridgeCalls) {
      assert.match(c.url, /\/candles\?symbol=[A-Z]+&interval=1d&count=2$/);
      assert.equal(c.auth, "Bearer bridge-secret");
    }
  });

  await test("MT5 quotes are cached (second fetch hits the bridge zero times)", async () => {
    resetMacroCacheForTests();
    bridgeCalls.length = 0;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.gold);
    const first = bridgeCalls.length;
    await fetchMacroInputs({ twelveDataKey: "k", fredKey: null, mt5: MT5 }, mt5Fetch(), ASSET_PROFILES.gold);
    assert.equal(bridgeCalls.length, first);
    resetMacroCacheForTests();
  });

  await test("price label: real instrument keeps its name, a proxy says so (silver / oil)", async () => {
    const { getMacroAlignmentSnapshot } = await import("../services/macro/macro-service");
    const saved = { u: process.env.MT5_BRIDGE_URL, s: process.env.MT5_BRIDGE_SECRET, t: process.env.TWELVEDATA_API_KEY, f: process.env.FRED_API_KEY };
    try {
      process.env.TWELVEDATA_API_KEY = "k";
      process.env.FRED_API_KEY = "f";
      process.env.MT5_BRIDGE_URL = MT5.bridgeUrl;
      process.env.MT5_BRIDGE_SECRET = MT5.secret;
      resetMacroCacheForTests();
      const real = await getMacroAlignmentSnapshot("silver", mt5Fetch());
      assert.equal(real.price?.label, "Silver");
      assert.equal(real.price?.text, "$60.60");
      resetMacroCacheForTests();
      const proxy = await getMacroAlignmentSnapshot("oil", mt5Fetch({ down: true }));
      assert.equal(proxy.price?.label, "USO oil ETF");
    } finally {
      for (const [k, v] of [["MT5_BRIDGE_URL", saved.u], ["MT5_BRIDGE_SECRET", saved.s], ["TWELVEDATA_API_KEY", saved.t], ["FRED_API_KEY", saved.f]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetMacroCacheForTests();
    }
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
