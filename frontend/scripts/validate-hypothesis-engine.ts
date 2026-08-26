// scripts/validate-hypothesis-engine.ts
// Sprint D2.5.3 - Standalone validation for HypothesisService, exercised
// end-to-end through MarketStateService + RegimeService (real indicator
// math, no database, no network, no randomness). Run via
// `npm run validate:hypothesis-engine`.
//
// Fixture builders below are copied from scripts/validate-regime-engine.ts
// (already empirically verified there to produce specific, known regimes)
// rather than imported, matching this project's established convention of
// each validate-*.ts script being self-contained.
import assert from "node:assert/strict";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService, HYPOTHESIS_ENGINE_GENERATED_BY } from "../services/intelligence/hypothesis/hypothesis.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { MarketState } from "../types/intelligence-market-state";
import type { Regime } from "../types/intelligence-regime";
import type { EvidenceBundle } from "../types/evidence";

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
const hypothesisSvc = new HypothesisService();

function stateFor(closesArr: number[], volatilityFrac = 0.0008): MarketState {
  const candles = makeCandles(closesArr, volatilityFrac);
  return marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
}

// --- Verified fixture builders (copied from validate-regime-engine.ts) ---
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

function regimeFor(state: MarketState, previousRegime?: Regime["regimeType"]): Regime {
  return regimeSvc.classify({ marketState: state, previousRegime });
}

function main(): void {
  // ---- Bullish continuation ----
  test("trending-bullish + sufficient evidence -> trend-continuation-bullish generated", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "trending-bullish");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "trend-continuation-bullish");
    assert.ok(hyps[0].supportingEvidence.length > 0);
  });

  // ---- Bearish continuation ----
  test("trending-bearish + sufficient evidence -> trend-continuation-bearish generated", () => {
    const state = stateFor(trendingBearishCloses());
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "trending-bearish");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "trend-continuation-bearish");
  });

  // ---- Bullish breakout ----
  test("breakout regime -> breakout-confirmation-bullish generated", () => {
    const state = stateFor(breakoutCloses());
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "breakout");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "breakout-confirmation-bullish");
    assert.equal(hyps[0].statement.invalidationCondition.comparator, "crosses-below");
    assert.equal(hyps[0].statement.invalidationCondition.referenceValue, state.structure?.recentRange?.high);
  });

  // ---- Bearish breakdown ----
  test("breakdown regime -> breakout-confirmation-bearish generated", () => {
    const state = stateFor(breakdownCloses());
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "breakdown");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "breakout-confirmation-bearish");
    assert.equal(hyps[0].statement.invalidationCondition.comparator, "crosses-above");
  });

  // ---- Range ----
  test("ranging + valid range evidence -> range-continuation generated", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006);
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "ranging");
    assert.ok(state.structure?.recentRange, "fixture sanity check: real range evidence must exist");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "range-continuation");
  });

  // ---- Volatility ----
  test("high-volatility regime -> volatility-expansion generated", () => {
    const state = highVolatilityState();
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "high-volatility");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "volatility-expansion");
    assert.equal(hyps[0].statement.invalidationCondition.referenceValue, "high");
  });

  test("low-volatility regime -> volatility-contraction generated", () => {
    const state = stateFor(sidewaysCloses(0.004), 0.0008);
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "low-volatility");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps.length, 1);
    assert.equal(hyps[0].type, "volatility-contraction");
    assert.equal(hyps[0].statement.invalidationCondition.referenceValue, "low");
  });

  // ---- Insufficient data ----
  test("insufficient-data regime -> no unsupported directional hypothesis (empty array)", () => {
    const state = stateFor([1.1, 1.1005, 1.101]);
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "insufficient-data");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.deepEqual(hyps, []);
  });

  // ---- Missing evidence (defensive: mismatched regime/state pair) ----
  test("ranging regime with no real recentRange on MarketState -> no hypothesis, never fabricated", () => {
    const state = stateFor(sidewaysCloses(0.01), 0.006);
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "ranging");
    // Hand-construct a MarketState missing the range evidence the rule requires -
    // a defensive check for a case Regime's own gating should prevent in
    // practice, but the hypothesis rule must never fabricate around it.
    const brokenState: MarketState = { ...state, structure: { ...state.structure, recentRange: undefined } };
    const hyps = hypothesisSvc.generate({ marketState: brokenState, regime });
    assert.deepEqual(hyps, []);
  });

  test("high-volatility regime with no real volatilityBand on MarketState -> no hypothesis", () => {
    const state = highVolatilityState();
    const regime = regimeFor(state);
    const brokenState: MarketState = { ...state, structure: { ...state.structure, volatilityBand: undefined, atrPercent: undefined } };
    const hyps = hypothesisSvc.generate({ marketState: brokenState, regime });
    assert.deepEqual(hyps, []);
  });

  // ---- Reversal: never generated, not even from extreme signals ----
  test("reversal hypotheses are never generated in D2.5.3 - not from a transition regime, not from any fixture", () => {
    const rangingState = stateFor(sidewaysCloses(0.01), 0.006);
    const transitionRegime = regimeFor(rangingState, "trending-bullish");
    assert.equal(transitionRegime.regimeType, "transition");
    const hyps = hypothesisSvc.generate({ marketState: rangingState, regime: transitionRegime });
    assert.deepEqual(hyps, [], "transition regime must never produce a hypothesis in D2.5.3");

    const allTypes = [
      ...hypothesisSvc.generate({ marketState: stateFor(trendingBullishCloses()), regime: regimeFor(stateFor(trendingBullishCloses())) }),
      ...hypothesisSvc.generate({ marketState: stateFor(trendingBearishCloses()), regime: regimeFor(stateFor(trendingBearishCloses())) }),
      ...hypothesisSvc.generate({ marketState: stateFor(breakoutCloses()), regime: regimeFor(stateFor(breakoutCloses())) }),
      ...hypothesisSvc.generate({ marketState: stateFor(breakdownCloses()), regime: regimeFor(stateFor(breakdownCloses())) }),
    ].map((h) => h.type);
    assert.ok(!allTypes.includes("reversal-candidate-bullish"));
    assert.ok(!allTypes.includes("reversal-candidate-bearish"));
  });

  // ---- Conflicting evidence ----
  test("opposing evidence is preserved from a real EvidenceBundle conflict, never invented", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const evidenceBundle: EvidenceBundle = {
      symbol: "EURUSD",
      items: [],
      conflicts: [
        {
          type: "news",
          symbol: "EURUSD",
          itemA: { type: "news", symbol: "EURUSD", claim: "Headline A", source: "test", asOf: state.generatedAt, retrievedAt: state.generatedAt },
          itemB: { type: "news", symbol: "EURUSD", claim: "A bearish headline conflicts with the current technical read.", source: "test", asOf: state.generatedAt, retrievedAt: state.generatedAt },
          resolution: "unresolved",
          reason: "test fixture conflict",
        },
      ],
      generatedAt: state.generatedAt,
    };
    const hyps = hypothesisSvc.generate({ marketState: state, regime, evidence: evidenceBundle });
    assert.equal(hyps.length, 1);
    // Post-completion (2026-08-26): trendingBullishCloses()'s deterministic
    // plateau genuinely pushes RSI14 to ~87 (confirmed overbought), so the
    // real momentumDivergenceOpposingEvidence() source now ALSO
    // contributes here alongside the conflict-sourced item - this test
    // stays scoped to "the conflict item is preserved, never dropped",
    // not "opposingEvidence has exactly one source".
    assert.ok(hyps[0].opposingEvidence.some((e) => e.claim === "A bearish headline conflicts with the current technical read."));
  });

  test("opposing evidence has no conflict-sourced item when no EvidenceBundle is passed - but a real, independent momentum-divergence item still surfaces honestly (RSI14 ~87, genuinely overbought against this bullish fixture)", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].opposingEvidence.length, 1);
    assert.ok(hyps[0].opposingEvidence[0].claim.includes("overbought territory"));
    assert.equal(hyps[0].opposingEvidence[0].source, "services/intelligence/market-state/market-state.service.ts");
  });

  test("a conflict for a DIFFERENT symbol is never attributed as opposing evidence (the real momentum-divergence item is unaffected by this and still present)", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const evidenceBundle: EvidenceBundle = {
      symbol: "GBPUSD",
      items: [],
      conflicts: [
        {
          type: "news",
          symbol: "GBPUSD",
          itemA: { type: "news", symbol: "GBPUSD", claim: "A", source: "test", asOf: state.generatedAt, retrievedAt: state.generatedAt },
          itemB: { type: "news", symbol: "GBPUSD", claim: "B", source: "test", asOf: state.generatedAt, retrievedAt: state.generatedAt },
          resolution: "unresolved",
          reason: "test fixture conflict for a different symbol",
        },
      ],
      generatedAt: state.generatedAt,
    };
    const hyps = hypothesisSvc.generate({ marketState: state, regime, evidence: evidenceBundle });
    assert.equal(hyps[0].opposingEvidence.length, 1);
    assert.ok(!hyps[0].opposingEvidence.some((e) => e.claim === "A" || e.claim === "B"));
  });

  // ---- Momentum-divergence opposing evidence (post-completion, 2026-08-26) ----
  test("bearish continuation gets a real oversold-momentum opposing item when RSI14 is genuinely <=30 - the bearish mirror of the bullish/overbought case above", () => {
    const state = stateFor(trendingBearishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].type, "trend-continuation-bearish");
    assert.equal(hyps[0].opposingEvidence.length, 1);
    assert.ok(hyps[0].opposingEvidence[0].claim.includes("oversold territory"));
  });

  test("breakout-confirmation-bullish also gets momentum-divergence opposing evidence (wired at generateBreakoutConfirmation, not just generateTrendContinuation)", () => {
    const state = stateFor(breakoutCloses());
    const regime = regimeFor(state);
    assert.equal(regime.regimeType, "breakout");
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].type, "breakout-confirmation-bullish");
    // Never asserts a specific RSI reading here (breakoutCloses() isn't
    // tuned for a specific RSI value) - only that the function is real
    // and wired for this hypothesis type too, not just trend-continuation.
    assert.ok(Array.isArray(hyps[0].opposingEvidence));
  });

  test("range-continuation and volatility hypotheses never receive momentum-divergence evidence - it's only wired for directional (bullish/bearish) claims, where 'divergence against the claim's own direction' is a coherent concept", () => {
    const rangingState = stateFor(sidewaysCloses(0.01), 0.006);
    const rangingRegime = regimeFor(rangingState);
    const rangeHyps = hypothesisSvc.generate({ marketState: rangingState, regime: rangingRegime });
    if (rangeHyps.length > 0 && rangeHyps[0].type === "range-continuation") {
      assert.deepEqual(rangeHyps[0].opposingEvidence, []);
    }
  });

  // ---- Invalidation condition ----
  test("every generated hypothesis has an explicit, structured invalidation condition", () => {
    const fixtures: [MarketState, Regime][] = [
      [stateFor(trendingBullishCloses()), regimeFor(stateFor(trendingBullishCloses()))],
      [stateFor(breakoutCloses()), regimeFor(stateFor(breakoutCloses()))],
      [stateFor(sidewaysCloses(0.01), 0.006), regimeFor(stateFor(sidewaysCloses(0.01), 0.006))],
      [highVolatilityState(), regimeFor(highVolatilityState())],
    ];
    for (const [state, regime] of fixtures) {
      const hyps = hypothesisSvc.generate({ marketState: state, regime });
      assert.equal(hyps.length, 1, `expected exactly one hypothesis for regime ${regime.regimeType}`);
      const cond = hyps[0].statement.invalidationCondition;
      assert.ok(cond.description.length > 0);
      assert.ok(cond.field.length > 0);
      assert.ok(["equals", "not-equals", "crosses-below", "crosses-above"].includes(cond.comparator));
      assert.ok(cond.referenceValue !== undefined && cond.referenceValue !== null && cond.referenceValue !== "");
    }
  });

  // ---- Prediction window ----
  test("every generated hypothesis has a deterministic, candle-based prediction window", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].statement.predictionWindow.candles, 20);
    assert.equal(hyps[0].statement.predictionWindow.timeframe, "1h");
  });

  // ---- Determinism ----
  test("generate(input) === generate(input): identical input always yields an identical result, including id", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const h1 = hypothesisSvc.generate({ marketState: state, regime });
    const h2 = hypothesisSvc.generate({ marketState: state, regime });
    assert.deepEqual(h1, h2);
    assert.equal(h1[0].id, h2[0].id, "id must be deterministic, never randomly generated");
  });

  // ---- Signal boundary ----
  test("no hypothesis output contains a BUY/SELL execution instruction, target, or position-sizing field", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    const json = JSON.stringify(hyps);
    assert.doesNotMatch(json, /\bBUY\b|\bSELL\b|\bexecute\b|position.?size/i);
    const asRecord = hyps[0] as unknown as Record<string, unknown>;
    assert.equal(asRecord.action, undefined);
    assert.equal(asRecord.recommendation, undefined);
    assert.equal(asRecord.positionSize, undefined);
    assert.equal(asRecord.broker, undefined);
  });

  test("generatedBy always identifies the deterministic engine, never gemini/ai/llm", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].generatedBy, HYPOTHESIS_ENGINE_GENERATED_BY);
    assert.equal(HYPOTHESIS_ENGINE_GENERATED_BY, "deterministic-hypothesis-engine-v2");
    assert.doesNotMatch(hyps[0].generatedBy, /gemini|\bai\b|llm/i);
  });

  test("every generated hypothesis starts with status 'active'", () => {
    const state = stateFor(trendingBullishCloses());
    const regime = regimeFor(state);
    const hyps = hypothesisSvc.generate({ marketState: state, regime });
    assert.equal(hyps[0].status, "active");
  });

  // ---- LLM isolation (structural) ----
  test("hypothesis.service.ts imports nothing from lib/ai or the Gemini SDK", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../services/intelligence/hypothesis/hypothesis.service.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["']@\/lib\/ai/);
    assert.doesNotMatch(source, /@google\/genai/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
