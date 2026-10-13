// scripts/validate-smc-engine.ts
// The SMC structure engine (port of the owner's MQL5 indicator), its service glue and
// its evidence source. Pure/in-memory: candles are synthetic and deterministic.
// `npm run validate:smc-engine`.

import assert from "node:assert/strict";
import { analyzeSmc, runBias, atrSeries, DEFAULT_SMC_PARAMS, type SmcCandle } from "../services/smc/smc-engine";
import { getSmcAnalysis, splitClosed, resetSmcCacheForTests, summariseSmc } from "../services/smc/smc-service";
import { SmcStructureEvidenceSource, smcClaims, fmtPrice, SMC_EVIDENCE_SOURCE } from "../services/evidence-sources/smc-evidence-source";
import { MarketIntelligencePipelineService } from "../services/ai/market-intelligence-pipeline.service";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import type { Candle } from "../types/market-candle";
import type { MarketDataProvider, MarketContextResult } from "../types/market-data-provider";

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

// ── builders ──
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday, 00:00 UTC
const HOUR = 3_600_000;
const iso = (i: number) => new Date(BASE + i * HOUR).toISOString();
type Ohlc = [number, number, number, number];
const toCandles = (rows: Ohlc[]): SmcCandle[] => rows.map(([o, h, l, c], i) => ({ time: iso(i), open: o, high: h, low: l, close: c }));

/** Closes -> candles: the open is halfway between the previous close and this close, so a turning point is a strict high / low (an open equal to the previous close would tie the neighbouring highs), +/- `r` wicks. */
function fromCloses(closes: number[], r = 0.5, _startIdx = 0, prevClose?: number): Ohlc[] {
  const rows: Ohlc[] = [];
  let prev = prevClose ?? closes[0];
  for (const c of closes) {
    const o = (prev + c) / 2;
    rows.push([o, Math.max(o, c) + r, Math.min(o, c) - r, c]);
    prev = c;
  }
  return rows;
}
const flat = (n: number, price: number, r = 0.5): Ohlc[] => Array.from({ length: n }, () => [price, price + r, price - r, price] as Ohlc);
/** Straight legs through (target, bars) turning points, one step per bar. */
function legs(start: number, plan: [number, number][]): number[] {
  const out: number[] = [];
  let p = start;
  for (const [target, bars] of plan) {
    for (let k = 1; k <= bars; k++) out.push(p + ((target - p) * k) / bars);
    p = target;
  }
  return out;
}

/** 30 flat bars, up 100->110, pull back to 104, break out to 116. */
function bullishScenario(): Ohlc[] {
  return [...flat(30, 100), ...fromCloses(legs(100, [[110, 10], [104, 6], [116, 12]]), 0.5, 0, 100)];
}

// seeded pseudo-random walk (deterministic)
function randomWalk(n: number, seed = 7): Ohlc[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);
  const rows: Ohlc[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + rnd() * 3;
    rows.push([o, Math.max(o, c) + Math.abs(rnd()) * 1.2, Math.min(o, c) - Math.abs(rnd()) * 1.2, c]);
    p = c;
  }
  return rows;
}

const analyze = (rows: Ohlc[], live?: number, htf: SmcCandle[] | null = null) => analyzeSmc(toCandles(rows), live ?? rows[rows.length - 1][3], htf);

async function main(): Promise<void> {
  console.log("validate-smc-engine\n");

  await test("ATR is a simple moving average of the true range (undefined until the period is filled)", () => {
    const a = atrSeries(toCandles(flat(20, 100, 0.5)), 14);
    assert.equal(a[12], undefined);
    assert.equal(a[13], 1);
    assert.equal(a[19], 1);
  });

  await test("not enough candles -> null (never an estimate)", () => {
    assert.equal(analyze(flat(20, 100)), null);
  });

  await test("a break above the confirmed swing high is a bullish BOS and flips the bias", () => {
    const a = analyze(bullishScenario())!;
    assert.equal(a.bias, "Bullish");
    assert.equal(a.lastEvent?.kind, "BOS");
    assert.equal(a.lastEvent?.dir, "Bullish");
    assert.ok(Math.abs((a.lastEvent?.level ?? 0) - 110.5) < 1e-9);
  });

  await test("a break of the protected low against a bullish bias is an MSS (bias flips bearish)", () => {
    const rows = [...bullishScenario(), ...fromCloses(legs(116, [[90, 25]]), 0.5, 0, 116)];
    const a = analyze(rows)!;
    assert.equal(a.bias, "Bearish");
    assert.equal(a.lastEvent?.kind, "MSS");
    assert.equal(a.lastEvent?.dir, "Bearish");
    assert.ok(a.eventLog.length >= 2);
  });

  await test("NO LOOK-AHEAD: events up to bar P are identical whether or not later candles exist", () => {
    const rows = randomWalk(380);
    const P = 300;
    const prefix = analyze(rows.slice(0, P))!;
    const full = analyze(rows)!;
    const early = full.eventLog.filter((e) => e.barIdx < P);
    const k = Math.min(early.length, prefix.eventLog.length);
    assert.ok(k >= 2, `only ${k} events to compare`);
    assert.deepEqual(early.slice(-k), prefix.eventLog.slice(-k));
  });

  await test("deterministic: the same candles give an identical analysis", () => {
    const rows = randomWalk(300, 11);
    assert.deepEqual(analyze(rows), analyze(rows));
  });

  await test("fair value gap: forms from three candles, is NOT 'tested' by its own candle, then partial fill = tested, full fill = mitigated", () => {
    const base = [...flat(30, 100), [100, 100.5, 99.5, 100], [100, 104, 100, 103.8], [103.8, 105, 103, 104.5]] as Ohlc[];
    const fresh = analyze([...base, [104.5, 106, 103.6, 105.5], [105.5, 107, 104.6, 106.5]])!;
    assert.equal(fresh.fvg?.dir, 1);
    assert.equal(fresh.fvg?.status, "fresh");
    assert.ok(Math.abs((fresh.fvg?.bot ?? 0) - 100.5) < 1e-9 && Math.abs((fresh.fvg?.top ?? 0) - 103) < 1e-9);
    const tested = analyze([...base, [104.5, 106, 103.6, 105.5], [105.5, 106.5, 102, 104], [104, 105, 103.4, 104.8]])!;
    assert.equal(tested.fvg?.status, "tested"); // filled ~40%
    const gone = analyze([...base, [104.5, 106, 103.6, 105.5], [105.5, 106.5, 99, 101], [101, 105, 100.6, 104.5]])!;
    assert.equal(gone.fvg === null || gone.fvg.top !== 103, true, "a fully filled FVG is mitigated and no longer active");
  });

  await test("order block: the last opposite candle before a displacement in the bias direction; not mitigated by the displacement bar itself", () => {
    const rows = [...bullishScenario(), [116, 116.5, 114.5, 115], [115, 119, 114.8, 118.8]] as Ohlc[];
    const a = analyze(rows)!;
    assert.equal(a.ob?.dir, 1);
    assert.ok(Math.abs((a.ob?.top ?? 0) - 116.5) < 1e-9 && Math.abs((a.ob?.bot ?? 0) - 114.5) < 1e-9);
    assert.equal(a.ob?.status, "fresh");
  });

  await test("liquidity sweep: previous-day high taken and closed back below -> PDH swept, timed by its own candle, fresh", () => {
    const day1: Ohlc[] = Array.from({ length: 24 }, (_, i) => (i === 10 ? ([103, 105.5, 102.5, 105] as Ohlc) : ([100 + (i % 3), 102 + (i % 3), 98 + (i % 3), 100 + ((i + 1) % 3)] as Ohlc)));
    const day2a = flat(16, 101, 1);
    const spike: Ohlc = [104, 108, 103, 103];
    const after = flat(9, 101, 1);
    const a = analyze([...day1, ...day2a, spike, ...after])!;
    assert.equal(a.sweep?.kind, "PDH");
    assert.equal(a.sweep?.fresh, true);
    assert.equal(a.sweep?.barsAgo, 9); // spike at idx 40, last closed idx 49 - its own candle, not "now"
    assert.equal(a.pools.find((p) => p.kind === "PDH")?.status, "swept");
  });

  await test("an old sweep is not fresh (expires by bar count, not wall-clock)", () => {
    const day1: Ohlc[] = Array.from({ length: 24 }, (_, i) => (i === 10 ? ([103, 105.5, 102.5, 105] as Ohlc) : ([100 + (i % 3), 102 + (i % 3), 98 + (i % 3), 100 + ((i + 1) % 3)] as Ohlc)));
    const a = analyze([...day1, ...flat(16, 101, 1), [104, 108, 103, 103] as Ohlc, ...flat(30, 101, 1)])!;
    assert.equal(a.sweep?.kind, "PDH");
    assert.equal(a.sweep?.fresh, false);
  });

  await test("higher-timeframe bias comes from the same swing/structure rules on its own candles", () => {
    const htf = runBias(toCandles(bullishScenario()), 5, 14);
    assert.equal(htf.bias, "Bullish");
    assert.match(htf.event, /BOS/);
    assert.deepEqual(runBias(toCandles(flat(60, 100)), 5, 14), { bias: "Neutral", event: "--" });
  });

  await test("score: bounded 0-100, equals the factor total over its denominator, aligned HTF adds the alignment points", () => {
    const rows = bullishScenario();
    const solo = analyze(rows)!;
    const withHtf = analyze(rows, undefined, toCandles(rows))!;
    for (const a of [solo, withHtf]) {
      assert.ok(a.score >= 0 && a.score <= 100);
      const raw = a.factors.reduce((s, f) => s + f.points, 0);
      const max = a.factors.reduce((s, f) => s + f.max, 0);
      assert.equal(a.score, Math.round(Math.min(100, Math.max(0, (raw / max) * 100))));
    }
    assert.equal(withHtf.aligned, true);
    assert.equal(solo.aligned, false); // no HTF data -> Neutral -> not aligned
    assert.ok(withHtf.factors.find((f) => f.label === "HTF alignment")!.points >= 25);
    assert.ok(withHtf.score > solo.score);
  });

  await test("lean is a structure lean, never BUY/SELL: weak/unaligned -> none; aligned and scored -> bullish-/bearish-leaning", () => {
    const rows = bullishScenario();
    const solo = analyze(rows)!;
    assert.equal(solo.lean, "none");
    assert.equal(solo.strength, "weak");
    const a = analyze(rows, undefined, toCandles(rows))!;
    const expected = a.score >= DEFAULT_SMC_PARAMS.scoreStrong ? "strong" : a.score >= DEFAULT_SMC_PARAMS.scoreDeveloping ? "developing" : "weak";
    assert.equal(a.strength, expected);
    assert.equal(a.lean, expected === "weak" ? "none" : "bullish-leaning");
    assert.ok(!/buy|sell|entry|stop|target/i.test(JSON.stringify(summariseSmc(a))));
  });

  // ── service glue ──
  const asProvider = (rows: Ohlc[]): Candle[] => rows.map(([open, high, low, close], i) => ({ datetime: iso(i), open, high, low, close }));

  await test("splitClosed: the forming candle is dropped (it supplies the live price); a candle whose interval already ended is kept", () => {
    const rows = bullishScenario();
    const cs = asProvider(rows);
    const lastMs = BASE + (rows.length - 1) * HOUR;
    const forming = splitClosed(cs, "1h", lastMs + 10 * 60_000)!; // 10 minutes into the last candle
    assert.equal(forming.closed.length, rows.length - 1);
    assert.equal(forming.livePrice, rows[rows.length - 1][3]);
    const closedAll = splitClosed(cs, "1h", lastMs + 2 * HOUR)!;
    assert.equal(closedAll.closed.length, rows.length);
    assert.equal(splitClosed(cs.slice(0, 1), "1h", lastMs), null);
  });

  await test("getSmcAnalysis: candles in -> analysis out; provider failure or too little data -> null", async () => {
    resetSmcCacheForTests();
    const rows = [...bullishScenario(), ...flat(1, 116)];
    const lastMs = BASE + (rows.length - 1) * HOUR;
    const get = async (_s: string, interval: string) => asProvider(interval === "1h" ? rows : bullishScenario());
    const a = await getSmcAnalysis("XAUUSD", { getCandles: get, now: () => lastMs + 600_000 });
    assert.ok(a && a.bias === "Bullish");
    assert.equal(await getSmcAnalysis("XAUUSD", { getCandles: async () => { throw new Error("down"); }, now: () => lastMs }), null);
    assert.equal(await getSmcAnalysis("XAUUSD", { getCandles: async () => asProvider(flat(10, 100)), now: () => lastMs }), null);
    // an unavailable higher timeframe only removes the HTF bias, it does not break the analysis
    const noHtf = await getSmcAnalysis("XAUUSD", { getCandles: async (_s, i) => { if (i === "4h") throw new Error("no 4h"); return asProvider(rows); }, now: () => lastMs + 600_000 });
    assert.ok(noHtf && noHtf.htf.bias === "Neutral");
  });

  // ── evidence ──
  const NOW = new Date(BASE + 400 * HOUR);
  const rowsE = [...bullishScenario(), [116, 116.5, 114.5, 115], [115, 119, 114.8, 118.8], [118.8, 119.6, 118.2, 119.2]] as Ohlc[];
  const analysisE = analyzeSmc(toCandles(rowsE).slice(0, -1), 119.2, toCandles(bullishScenario()))!;

  await test("evidence claims: structure facts + lean, with price formatting per instrument and no trade instructions", () => {
    const claims = smcClaims(analysisE);
    assert.ok(claims[0].startsWith("1h structure is bullish"));
    assert.ok(claims.some((c) => /^Active bullish order block 114\.500-116\.500 \(fresh\)/.test(c)) || claims.some((c) => /order block/.test(c)));
    const last = claims[claims.length - 1];
    assert.match(last, /^SMC structure lean: (bullish-leaning|none)/);
    assert.match(last, /rule-based structure with unvalidated weights, not a trade signal$/);
    for (const c of claims) assert.ok(!/(buy|sell)(?!-side)|(entry|stop[- ]?loss|take[- ]?profit)/i.test(c), `trade wording in: ${c}`);
    assert.equal(fmtPrice(4170.05), "4170.05");
    assert.equal(fmtPrice(158.372), "158.372");
    assert.equal(fmtPrice(1.11916), "1.11916");
  });

  await test("evidence source: technical items under ONE source name; zero ranking conflicts together with a price item; no data -> no items", async () => {
    const src = new SmcStructureEvidenceSource({ getAnalysis: async () => analysisE, now: () => NOW });
    const items = await src.collect({ symbol: "XAUUSD" });
    assert.ok(items.length >= 3);
    assert.ok(items.every((i) => i.type === "technical" && i.source === SMC_EVIDENCE_SOURCE && i.asOf === analysisE.lastClosedTime));
    const price = { type: "price" as const, symbol: "XAUUSD", claim: "last 119.2", source: "fake", asOf: NOW.toISOString(), retrievedAt: NOW.toISOString(), magnitude: 119.2 };
    assert.equal(new EvidenceRankingService().buildBundle("XAUUSD", [price, ...items], NOW.toISOString()).conflicts.length, 0);
    assert.deepEqual(await new SmcStructureEvidenceSource({ getAnalysis: async () => null }).collect({ symbol: "XAUUSD" }), []);
  });

  await test("pipeline: the SMC source lifts the evidence from price-only to price + technical", async () => {
    const provider: MarketDataProvider = {
      name: "fake",
      isConfigured: () => true,
      getMarketContext: async (req) => ({ symbol: req.symbol, provider: "fake", retrievedAt: NOW.toISOString(), evidence: [{ claim: "XAUUSD last price 119.2", source: "fake", asOf: NOW.toISOString() }] }) as MarketContextResult,
    };
    const smc = new SmcStructureEvidenceSource({ getAnalysis: async () => analysisE, now: () => NOW });
    const out = await new MarketIntelligencePipelineService(provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null, [smc]).run({ symbol: "XAUUSD" });
    assert.equal(out.status, "completed");
    if (out.status !== "completed") return;
    assert.deepEqual([...new Set(out.result.evidence.items.map((i) => i.type))].sort(), ["price", "technical"]);
    assert.equal(out.result.evidence.conflicts.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
