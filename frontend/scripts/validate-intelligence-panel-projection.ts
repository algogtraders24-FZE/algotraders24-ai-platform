// scripts/validate-intelligence-panel-projection.ts
// Sprint D2.8.16 - regression coverage for
// services/intelligence/chat/intelligence-panel-projection.service.ts, the
// fix for a real, live-reproduced bug: the Workspace page's "AI
// Intelligence" panel and "Research" panel disagreeing outright for the
// same symbol at the same moment because they read two disconnected
// engines. This script proves the projection is a faithful, honest mapping
// from the SAME VerifiedAnswerResponse the Research panel already renders -
// no new computation, no silently-invented value.
import assert from "node:assert/strict";
import { buildIntelligencePanelDataFromVerifiedAnswer } from "../services/intelligence/chat/intelligence-panel-projection.service";
import type { VerifiedAnswerResponse } from "../types/verified-answer-response";

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

// Minimal, deliberately partial fixture builder - only the fields the
// projection actually reads are ever populated per-test, matching this
// codebase's own "empirically verify against real shapes, don't over-fixture"
// convention (see D2.5.2's memory note on this).
function fixture(overrides: Partial<VerifiedAnswerResponse> = {}): VerifiedAnswerResponse {
  return {
    answer: "test",
    decisionState: "well-supported",
    intelligenceScore: {
      symbol: "EURUSD",
      timeframe: "1h",
      overallScore: 80,
      components: {} as VerifiedAnswerResponse["intelligenceScore"]["components"],
      methodology: { version: "1.0.0", formula: "", weights: {} as never },
      basis: [],
      limitations: [],
      generatedAt: "2026-08-18T10:00:00.000Z",
      pipelineVersion: "15D.12.0",
      intelligenceEngineVersion: "2.0.0",
    },
    dataStatus: "fresh",
    fallbackUsed: false,
    marketContext: {
      symbol: "EURUSD",
      timeframe: "1h",
      regimeType: "trending-bullish",
      regimeConfidence: 75,
    },
    currentState: {
      price: 1.1577,
      trendDirection: "up",
      rsi14: 64.1,
      atr14: 0.004,
      volatilityBand: "low",
      dataQuality: { band: "high", computed: 5, total: 5, note: "5 of 5 computable" },
      basis: ["EMA20 above EMA50"],
    },
    supportingEvidence: [],
    opposingEvidence: [],
    unresolvedConflicts: [],
    hypotheses: [],
    invalidationConditions: [],
    riskContext: { overallLevel: "low", categories: [], categoriesWithEvidence: [], categoriesUnavailable: [], basis: ["ATR(14) is 0.37% of price - low volatility."], dataAvailable: true },
    historicalContext: { status: "unavailable", basis: [] },
    missingInformation: [],
    presentedBy: "deterministic-research-snapshot",
    generatedAt: "2026-08-18T10:00:00.000Z",
    version: "1.0.0",
    ...overrides,
  };
}

function coreMappingTests(): void {
  test("1: a well-supported, trending-bullish answer maps to marketStatus bullish", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture());
    assert.equal(panel.marketStatus, "bullish");
  });

  test("2: the panel's confidence.percent is the EXACT same intelligenceScore.overallScore the Research panel shows - never a second number", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: 31 } }));
    assert.equal(panel.confidence.percent, 31);
  });

  test("3: decisionState insufficient-intelligence forces marketStatus to insufficient regardless of regimeType", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ decisionState: "insufficient-intelligence", marketContext: { ...fixture().marketContext, regimeType: "trending-bullish" } }),
    );
    assert.equal(panel.marketStatus, "insufficient");
  });

  test("4: regimeType insufficient-data alone (independent of decisionState) also forces marketStatus insufficient", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "insufficient-data" } }));
    assert.equal(panel.marketStatus, "insufficient");
  });

  test("5: trending-bearish maps to bearish, breakdown also maps to bearish (never conflated with a different label)", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "trending-bearish" } })).marketStatus, "bearish");
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "breakdown" } })).marketStatus, "bearish");
  });

  test("6: ranging maps to neutral - never fabricated as bullish/bearish", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "ranging" } })).marketStatus, "neutral");
  });

  test("7: high-volatility regime maps to high_volatility status, distinct from a directional call", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "high-volatility" } })).marketStatus, "high_volatility");
  });

  test("8: an undefined overallScore (total-blackout case) yields confidence band insufficient and percent 0 - never a fabricated number", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: undefined } }));
    assert.equal(panel.confidence.band, "insufficient");
    assert.equal(panel.confidence.percent, 0);
  });

  test("9: confidence banding matches D2.5.5's own documented CEILING_INSUFFICIENT_REGIME=40 boundary - 39 is low, 40 is medium", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: 39 } })).confidence.band, "low");
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: 40 } })).confidence.band, "medium");
  });

  test("10: 69 is medium, 70 is high", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: 69 } })).confidence.band, "medium");
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ intelligenceScore: { ...fixture().intelligenceScore, overallScore: 70 } })).confidence.band, "high");
  });

  test("11: risk.band is a direct passthrough of riskContext.overallLevel, never recomputed", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ riskContext: { ...fixture().riskContext, overallLevel: "high" } })).risk.band, "high");
  });

  test("12: an undefined riskContext.overallLevel maps to risk.band insufficient, never a guessed low/medium/high", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ riskContext: { ...fixture().riskContext, overallLevel: undefined } })).risk.band, "insufficient");
  });

  test("13: structure.momentum is always undefined - D2.5.x's DecisionCurrentState has no MACD-equivalent signal, never fabricated", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture()).structure.momentum, undefined);
  });

  test("14: structure.session is 'unknown' only when currentState.marketStatus is genuinely absent - honestly not guessed either way", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ currentState: { ...fixture().currentState, marketStatus: undefined } }));
    assert.equal(panel.structure.session, "unknown");
  });

  test("14a: structure.session is REAL once currentState.marketStatus is supplied (post-completion, 2026-08-26) - direct passthrough of MarketState.snapshot.marketStatus, never a fabricated default", () => {
    const openPanel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ currentState: { ...fixture().currentState, marketStatus: "open" } }));
    assert.equal(openPanel.structure.session, "open");
    const closedPanel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ currentState: { ...fixture().currentState, marketStatus: "closed" } }));
    assert.equal(closedPanel.structure.session, "closed");
  });

  test("15: structure.trend/bias derive from the real currentState.trendDirection ('up' -> 'bullish'), never a static default", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture());
    assert.equal(panel.structure.trend, "bullish");
    assert.equal(panel.structure.bias, "bullish");
  });

  test("16: an absent trendDirection leaves structure.trend/bias undefined, never guessed", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ currentState: { ...fixture().currentState, trendDirection: undefined } }));
    assert.equal(panel.structure.trend, undefined);
    assert.equal(panel.structure.bias, undefined);
  });

  // Sprint D2.7.11 (post-completion) - Key Levels now REAL, reversing the
  // D2.2 Phase 7 "no invented support/resistance" rule with the user's
  // explicit sign-off (2026-08-25). Sourced from DecisionCurrentState.
  // recentRange - already computed by market-state.service.ts, never
  // recomputed here - via the SAME keyPriceLevels() derivation the legacy
  // CopilotAnalysis pipeline uses, so the two panels can never disagree.

  test("17: with no recentRange (too few candles upstream), resistance/support/pullback are honestly undefined - never fabricated", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture());
    assert.equal(panel.keyLevels.resistance, undefined);
    assert.equal(panel.keyLevels.support, undefined);
    assert.equal(panel.keyLevels.pullback, undefined);
  });

  test("17a: with a real recentRange, resistance/support are exactly its high/low - a real derivation, never invented", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ currentState: { ...fixture().currentState, recentRange: { high: 1.165, low: 1.145, lookbackBars: 20 } } }),
    );
    assert.equal(panel.keyLevels.resistance, 1.165);
    assert.equal(panel.keyLevels.support, 1.145);
  });

  test("17b: pullback is exactly the standard 61.8% Fibonacci retracement between resistance and support - the same real ratio MT5's own Fibonacci Retracement tool defaults to", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ currentState: { ...fixture().currentState, recentRange: { high: 1.2, low: 1.0, lookbackBars: 20 } } }),
    );
    assert.ok(Math.abs((panel.keyLevels.pullback as number) - (1.2 - 0.2 * 0.618)) < 1e-9);
  });

  test("17c: with a bullish bias and a real range, invalidation is the real support and breakout is the real resistance", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ currentState: { ...fixture().currentState, trendDirection: "up", recentRange: { high: 1.165, low: 1.145, lookbackBars: 20 } } }),
    );
    assert.equal(panel.keyLevels.invalidation, 1.145);
    assert.equal(panel.keyLevels.breakout, 1.165);
  });

  test("17d: with a bearish bias, invalidation/breakout mirror (invalidation = resistance, breakout = support)", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ currentState: { ...fixture().currentState, trendDirection: "down", recentRange: { high: 1.165, low: 1.145, lookbackBars: 20 } } }),
    );
    assert.equal(panel.keyLevels.invalidation, 1.165);
    assert.equal(panel.keyLevels.breakout, 1.145);
  });

  test("17e: with a sideways/neutral bias, invalidation and breakout stay honestly undefined - no directional structure to invalidate or break out of", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(
      fixture({ currentState: { ...fixture().currentState, trendDirection: "sideways", recentRange: { high: 1.165, low: 1.145, lookbackBars: 20 } } }),
    );
    assert.equal(panel.keyLevels.invalidation, undefined);
    assert.equal(panel.keyLevels.breakout, undefined);
    // resistance/support/pullback are still real - only the bias-dependent fields are gated
    assert.equal(panel.keyLevels.resistance, 1.165);
  });

  test("18: evidence is the real supportingEvidence claims, capped at 4, never invented text", () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({ type: "price" as const, symbol: "EURUSD" as const, claim: `claim ${n}`, source: "twelve-data", asOf: "2026-08-18T10:00:00.000Z", retrievedAt: "2026-08-18T10:00:00.000Z" }));
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ supportingEvidence: items }));
    assert.deepEqual(panel.evidence, ["claim 1", "claim 2", "claim 3", "claim 4"]);
  });

  test("19: symbol/timeframe/computedAt are direct passthroughs of marketContext/generatedAt, never re-derived", () => {
    const panel = buildIntelligencePanelDataFromVerifiedAnswer(fixture());
    assert.equal(panel.symbol, "EURUSD");
    assert.equal(panel.timeframe, "1h");
    assert.equal(panel.computedAt, "2026-08-18T10:00:00.000Z");
  });

  test("20: transition regime maps to transition status, distinct from bullish/bearish/neutral", () => {
    assert.equal(buildIntelligencePanelDataFromVerifiedAnswer(fixture({ marketContext: { ...fixture().marketContext, regimeType: "transition" } })).marketStatus, "transition");
  });
}

async function main(): Promise<void> {
  coreMappingTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
