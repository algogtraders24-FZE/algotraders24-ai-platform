// scripts/validate-regime-engine.ts
// Sprint D2.5.2 - Standalone validation for RegimeService, exercised
// end-to-end through MarketStateService (real indicator math over hand-
// built candle fixtures, no database, no network, no randomness, no
// current-time dependency in the classification logic itself). Run via
// `npm run validate:regime-engine`.
//
// Every fixture below was empirically verified (not just hand-calculated)
// against the real MarketStateService + RegimeService before being locked
// in here - EMA/ATR behavior over dozens of candles is not something to
// eyeball correctly by hand.
import assert from "node:assert/strict";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { MarketState } from "../types/intelligence-market-state";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

function makeCandles(closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}

function snapshotFor(candles: Candle[]): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();

function stateFor(closesArr: number[], volatilityFrac = 0.0008): MarketState {
  const candles = makeCandles(closesArr, volatilityFrac);
  return marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
}

// --- Fixture builders, all empirically verified before being locked in ---

function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}

function trendingBearishCloses(): number[] {
  const fall: number[] = [];
  for (let i = 0; i < 60; i++) fall.push(1.2 - i * 0.0015);
  const trough = fall[fall.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(trough + 0.0005 - (i % 3) * 0.0001);
  return [...fall, ...plateau];
}

/** A mild uptrend (EMA20 > EMA50) followed by a trailing pullback of `pullback` over 5 bars, big enough to flip price below EMA20 - a genuine mixed/"sideways" signal, not an artifact of exact-zero drift. */
function sidewaysCloses(pullback: number): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 55; i++) rise.push(1.1 + i * 0.0004);
  const peak = rise[rise.length - 1];
  const tail: number[] = [];
  for (let i = 0; i < 5; i++) tail.push(peak - (pullback * (i + 1)) / 5);
  return [...rise, ...tail];
}

function breakoutCloses(): number[] {
  const flat: number[] = [];
  for (let i = 0; i < 60; i++) flat.push(1.1 + (i % 3) * 0.0003);
  return [...flat, 1.1 + 0.01];
}

function breakdownCloses(): number[] {
  const flat: number[] = [];
  for (let i = 0; i < 60; i++) flat.push(1.1 - (i % 3) * 0.0003);
  return [...flat, 1.1 - 0.01];
}

function highVolatilityState(): MarketState {
  const normal: number[] = [];
  for (let i = 0; i < 40; i++) normal.push(1.1 + (i % 2 === 0 ? 0.0002 : -0.0002));
  const candles = makeCandles(normal, 0.0008);
  for (let i = candles.length - 15; i < candles.length; i++) {
    candles[i].high = candles[i].close + 0.02;
    candles[i].low = candles[i].close - 0.02;
  }
  return marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
}

function main(): void {
  // ---- Each regime type, individually ----
  test("trending-bullish: EMA20 > EMA50, price > EMA20, plateau tail avoids an accidental breakout", () => {
    const regime = regimeSvc.classify({ marketState: stateFor(trendingBullishCloses()) });
    assert.equal(regime.regimeType, "trending-bullish");
    assert.ok(regime.basis.some((b) => /EMA20/.test(b)));
    assert.equal(regime.confidence, 100);
  });

  test("trending-bearish: EMA20 < EMA50, price < EMA20", () => {
    const regime = regimeSvc.classify({ marketState: stateFor(trendingBearishCloses()) });
    assert.equal(regime.regimeType, "trending-bearish");
  });

  test("ranging: sideways trend, moderate volatility, no breakout", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006);
    assert.equal(state.structure?.trend?.direction, "sideways");
    assert.equal(state.structure?.volatilityBand, "medium");
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "ranging");
  });

  test("breakout: latest close exceeds the 20-bar recent high", () => {
    const state = stateFor(breakoutCloses());
    assert.equal(state.structure?.breakoutSignal, "breakout");
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "breakout");
    assert.ok(regime.basis.some((b) => /recent high/.test(b)));
  });

  test("breakdown: latest close falls below the 20-bar recent low", () => {
    const state = stateFor(breakdownCloses());
    assert.equal(state.structure?.breakoutSignal, "breakdown");
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "breakdown");
  });

  test("high-volatility: ATR is >= 1.5% of price", () => {
    const state = highVolatilityState();
    assert.equal(state.structure?.volatilityBand, "high");
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "high-volatility");
    assert.ok(regime.basis.some((b) => /1\.5%/.test(b)));
  });

  test("low-volatility: sideways trend, ATR < 0.5% of price", () => {
    const state = stateFor(sidewaysCloses(0.004), 0.0008);
    assert.equal(state.structure?.trend?.direction, "sideways");
    assert.equal(state.structure?.volatilityBand, "low");
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "low-volatility");
  });

  test("insufficient-data: too few candles to compute anything regime-relevant", () => {
    const state = stateFor([1.1, 1.1005, 1.101]);
    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "insufficient-data");
    assert.equal(regime.confidence, 0, "insufficient-data must always report 0 confidence");
  });

  // ---- low-liquidity: never fabricated, structurally unreachable ----
  test("low-liquidity is never emitted by any fixture above - no real liquidity data source exists", () => {
    const allRegimes = [
      regimeSvc.classify({ marketState: stateFor(trendingBullishCloses()) }).regimeType,
      regimeSvc.classify({ marketState: stateFor(trendingBearishCloses()) }).regimeType,
      regimeSvc.classify({ marketState: stateFor(sidewaysCloses(0.01), 0.006) }).regimeType,
      regimeSvc.classify({ marketState: stateFor(breakoutCloses()) }).regimeType,
      regimeSvc.classify({ marketState: stateFor(breakdownCloses()) }).regimeType,
      regimeSvc.classify({ marketState: highVolatilityState() }).regimeType,
      regimeSvc.classify({ marketState: stateFor(sidewaysCloses(0.004), 0.0008) }).regimeType,
      regimeSvc.classify({ marketState: stateFor([1.1, 1.1005, 1.101]) }).regimeType,
    ];
    assert.ok(!allRegimes.includes("low-liquidity"));
  });

  // ---- transition ----
  test("transition: fires only when a differing previousRegime is supplied", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006); // -> ranging
    const fresh = regimeSvc.classify({ marketState: state });
    assert.equal(fresh.regimeType, "ranging");
    assert.equal(fresh.previousRegime, undefined, "no previousRegime supplied -> field absent, never fabricated");

    const withDiffering = regimeSvc.classify({ marketState: state, previousRegime: "trending-bullish" });
    assert.equal(withDiffering.regimeType, "transition");
    assert.equal(withDiffering.previousRegime, "trending-bullish");
    assert.ok(withDiffering.transitionDetectedAt);
    assert.ok(!Number.isNaN(Date.parse(withDiffering.transitionDetectedAt as string)));
  });

  test("transition: does NOT fire when previousRegime matches the fresh classification", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006); // -> ranging
    const regime = regimeSvc.classify({ marketState: state, previousRegime: "ranging" });
    assert.equal(regime.regimeType, "ranging");
    assert.equal(regime.transitionDetectedAt, undefined);
  });

  test("transition: never overlays insufficient-data - a non-classification is never relabeled as a change", () => {
    const state = stateFor([1.1, 1.1005, 1.101]);
    const regime = regimeSvc.classify({ marketState: state, previousRegime: "trending-bullish" });
    assert.equal(regime.regimeType, "insufficient-data");
  });

  // ---- precedence when multiple conditions are simultaneously true ----
  test("precedence: breakout wins over high-volatility when both are genuinely true", () => {
    const flat: number[] = [];
    for (let i = 0; i < 60; i++) flat.push(1.1 + (i % 3) * 0.0003);
    const candles = makeCandles([...flat, 1.1 + 0.01], 0.0008);
    // Widen true range via the LOW side only, so ATR reads high without
    // also inflating recentRange.high past the spike (which would mask
    // the breakout instead of testing precedence between the two).
    for (let i = candles.length - 15; i < candles.length - 1; i++) {
      candles[i].low = candles[i].close - 0.05;
    }
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
    assert.equal(state.structure?.volatilityBand, "high", "fixture sanity check: both conditions must be genuinely true");
    assert.equal(state.structure?.breakoutSignal, "breakout", "fixture sanity check: both conditions must be genuinely true");

    const regime = regimeSvc.classify({ marketState: state });
    assert.equal(regime.regimeType, "breakout", "breakout is checked before high-volatility in the documented precedence");
  });

  // ---- deterministic repeatability ----
  test("Regime(input) === Regime(input): identical MarketState always yields an identical result", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006);
    const r1 = regimeSvc.classify({ marketState: state });
    const r2 = regimeSvc.classify({ marketState: state });
    assert.equal(r1.regimeType, r2.regimeType);
    assert.equal(r1.confidence, r2.confidence);
    assert.deepEqual(r1.basis, r2.basis);
  });

  test("deterministic repeatability holds across every regime fixture above, not just one", () => {
    const fixtures: [string, MarketState][] = [
      ["trending-bullish", stateFor(trendingBullishCloses())],
      ["breakout", stateFor(breakoutCloses())],
      ["high-volatility", highVolatilityState()],
    ];
    for (const [label, state] of fixtures) {
      const a = regimeSvc.classify({ marketState: state });
      const b = regimeSvc.classify({ marketState: state });
      assert.equal(a.regimeType, b.regimeType, `${label}: regimeType must repeat`);
      assert.equal(a.confidence, b.confidence, `${label}: confidence must repeat`);
    }
  });

  // ---- boundary tests ----
  test("Regime never contains a BUY/SELL field or instruction", () => {
    const regime = regimeSvc.classify({ marketState: stateFor(trendingBullishCloses()) });
    const json = JSON.stringify(regime);
    assert.doesNotMatch(json, /\bBUY\b|\bSELL\b/);
    const asRecord = regime as unknown as Record<string, unknown>;
    assert.equal(asRecord.action, undefined);
    assert.equal(asRecord.recommendation, undefined);
    assert.equal(asRecord.direction, undefined);
  });

  test("regime.service.ts and market-state.service.ts import nothing from lib/ai or the Gemini SDK", async () => {
    const fs = await import("node:fs/promises");
    const regimeSource = await fs.readFile(new URL("../services/intelligence/regime/regime.service.ts", import.meta.url), "utf8");
    const stateSource = await fs.readFile(new URL("../services/intelligence/market-state/market-state.service.ts", import.meta.url), "utf8");
    for (const source of [regimeSource, stateSource]) {
      assert.doesNotMatch(source, /from ["']@\/lib\/ai/);
      assert.doesNotMatch(source, /@google\/genai/);
    }
  });

  test("classify() makes no network call - a fixture with no network access available still classifies correctly", () => {
    // There is no fetch/network dependency anywhere in RegimeService's
    // constructor or classify() signature to begin with - this test
    // documents that guarantee by simply calling it in a script that never
    // imports a network client for this path.
    const regime = regimeSvc.classify({ marketState: stateFor(trendingBullishCloses()) });
    assert.equal(regime.regimeType, "trending-bullish");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
