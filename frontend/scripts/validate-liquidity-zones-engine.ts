// scripts/validate-liquidity-zones-engine.ts
// Post-completion addition (2026-08-26) - real SMC (Smart Money Concepts)
// Liquidity Zones: Equal High / Equal Low. A price-action-derived proxy,
// ported directly from ea-research/G01_LiquiditySweep_MSS_FVG/Include/
// AT24_G01_Liquidity.mqh's own tested G01_DetectEqualHigh/G01_DetectEqualLow
// (same algorithm, same tuned 0.10 x ATR14 tolerance) - not a fresh
// invention. Covers the pure engine (lib/market-data/indicators.ts's
// liquidityZones()), the MarketStateService wiring, and both intelligence
// pipelines' passthrough (services/intelligence/chat/intelligence-panel-
// projection.service.ts for DecisionContext, services/ai/intelligence-panel
// .service.ts's honest {} for the legacy CopilotAnalysis pipeline, which
// has no MarketState.structure to compute this from).
import assert from "node:assert/strict";
import { liquidityZones } from "../lib/market-data/indicators";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { buildIntelligencePanelDataFromVerifiedAnswer } from "../services/intelligence/chat/intelligence-panel-projection.service";
import { buildIntelligencePanelData } from "../services/ai/intelligence-panel.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { CopilotAnalysis } from "../services/ai/trading-copilot.service";
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

// Deliberately hand-built (not a formula loop) so every fractal's wing
// condition is easy to verify by eye - see the inline commentary for which
// candle forms which fractal and why.
function equalLevelsFixture(): { high: number; low: number; close: number }[] {
  return [
    { high: 100, low: 99, close: 99.5 }, // 0
    { high: 101, low: 100, close: 100.5 }, // 1
    { high: 102, low: 101, close: 101.5 }, // 2
    { high: 103, low: 102, close: 102.5 }, // 3
    { high: 104, low: 103, close: 103.5 }, // 4
    { high: 110, low: 104, close: 107 }, // 5 - Equal High A (110)
    { high: 105, low: 100, close: 102 }, // 6
    { high: 104, low: 99, close: 101 }, // 7
    { high: 103, low: 90, close: 95 }, // 8 - Equal Low A (90)
    { high: 104, low: 98, close: 100 }, // 9
    { high: 105, low: 97, close: 101 }, // 10
    { high: 106, low: 98, close: 102 }, // 11
    { high: 107, low: 99, close: 103 }, // 12
    { high: 108, low: 100, close: 104 }, // 13
    { high: 109, low: 101, close: 105 }, // 14
    { high: 110.03, low: 102, close: 106 }, // 15 - Equal High B (110.03, within 0.10 ATR of A)
    { high: 105, low: 100, close: 102 }, // 16
    { high: 104, low: 99, close: 101 }, // 17
    { high: 103, low: 90.02, close: 95 }, // 18 - Equal Low B (90.02, within 0.10 ATR of A)
    { high: 104, low: 98, close: 100 }, // 19
    { high: 105, low: 97, close: 101 }, // 20
  ];
}

function pureEngineTests(): void {
  const ATR14 = 1.0; // tolerance = 0.10 x 1.0 = 0.10

  test("1: {} when atr14 is undefined - never a fabricated level without a real tolerance basis", () => {
    assert.deepEqual(liquidityZones(equalLevelsFixture(), undefined), {});
  });

  test("2: {} when there aren't enough candles for even one real fractal", () => {
    assert.deepEqual(liquidityZones(equalLevelsFixture().slice(0, 4), ATR14), {});
  });

  test("3: detects the real Equal High pair (110 and 110.03, both within 0.10 ATR) - level is the pair's own MAX (the real resting buy-side liquidity, above both wicks)", () => {
    const zones = liquidityZones(equalLevelsFixture(), ATR14);
    assert.ok(zones.equalHigh);
    assert.equal(zones.equalHigh!.price, 110.03);
    assert.equal(zones.equalHigh!.touches, 2);
  });

  test("4: detects the real Equal Low pair (90 and 90.02, both within 0.10 ATR) - level is the pair's own MIN (the real resting sell-side liquidity, below both wicks)", () => {
    const zones = liquidityZones(equalLevelsFixture(), ATR14);
    assert.ok(zones.equalLow);
    assert.equal(zones.equalLow!.price, 90);
    assert.equal(zones.equalLow!.touches, 2);
  });

  test("5: no Equal High/Low when the two real fractal extremes are genuinely too far apart for the tolerance - never a fabricated match", () => {
    const farApart = equalLevelsFixture();
    farApart[15] = { ...farApart[15], high: 115 }; // was 110.03 (within tolerance) -> now 5 away, well beyond 0.10 ATR
    farApart[18] = { ...farApart[18], low: 80 }; // was 90.02 (within tolerance) -> now 10 away
    const zones = liquidityZones(farApart, ATR14);
    assert.equal(zones.equalHigh, undefined);
    assert.equal(zones.equalLow, undefined);
  });

  test("6: a non-positive atr14 is treated the same as undefined - never divides by/multiplies against a nonsensical tolerance", () => {
    assert.deepEqual(liquidityZones(equalLevelsFixture(), 0), {});
  });
}

function marketStateWiringTests(): void {
  const service = new MarketStateService();
  const start = Date.parse("2026-01-01T00:00:00Z");

  function toCandles(bars: { high: number; low: number; close: number }[]): Candle[] {
    return bars.map((b, i) => ({
      datetime: new Date(start + i * 3_600_000).toISOString(),
      open: b.close,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: 500,
    }));
  }

  test("7: MarketState.structure.liquidityZones is real once ATR14 is computable and a real cluster exists - not recomputed, matches the pure engine exactly for the same candles/ATR", () => {
    // Pad with enough leading candles for a real ATR14/EMA warm-up, then
    // append the hand-built equal-level fixture at the end so the fractal
    // wing conditions (checked relative to array position) still hold.
    const warmup = Array.from({ length: 30 }, (_, i) => ({ high: 100 + i * 0.01, low: 99 + i * 0.01, close: 99.5 + i * 0.01 }));
    const bars = [...warmup, ...equalLevelsFixture()];
    const candles = toCandles(bars);
    const snapshot: MarketSnapshot = {
      symbol: "EURUSD",
      assetClass: "forex",
      price: candles[candles.length - 1].close,
      quoteCurrency: "USD",
      timestamp: candles[candles.length - 1].datetime,
      timezone: "UTC",
      marketStatus: "open",
      provider: "test",
    } as MarketSnapshot;
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.ok(state.technical?.atr14 !== undefined, "ATR14 must be computable for this wiring test to be meaningful");
    const expected = liquidityZones(candles, state.technical!.atr14);
    assert.deepEqual(state.structure?.liquidityZones, expected);
  });

  test("8: MarketState.structure.liquidityZones is honestly {} for too few candles - never a fabricated cluster", () => {
    const candles = toCandles(equalLevelsFixture()).slice(0, 3);
    const snapshot: MarketSnapshot = {
      symbol: "EURUSD",
      assetClass: "forex",
      price: candles[candles.length - 1].close,
      quoteCurrency: "USD",
      timestamp: candles[candles.length - 1].datetime,
      timezone: "UTC",
      marketStatus: "open",
      provider: "test",
    } as MarketSnapshot;
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.deepEqual(state.structure?.liquidityZones, {});
  });
}

function decisionContextPanelPassthroughTests(): void {
  test("9: intelligence-panel-projection.service.ts (DecisionContext pipeline) passes va.currentState.liquidityZones straight through, honestly {} when absent", () => {
    const fixture = (liquidityZones: VerifiedAnswerResponse["currentState"]["liquidityZones"]): VerifiedAnswerResponse =>
      ({
        answer: "",
        decisionState: "well-supported",
        intelligenceScore: { overallScore: 80 } as VerifiedAnswerResponse["intelligenceScore"],
        dataStatus: "fresh",
        fallbackUsed: false,
        marketContext: { symbol: "EURUSD", timeframe: "1h", regimeType: "trending-bullish", regimeConfidence: 80 },
        currentState: { price: 1.1, dataQuality: { band: "high", computed: 7, total: 7, note: "" }, basis: [], liquidityZones },
        supportingEvidence: [],
        opposingEvidence: [],
        unresolvedConflicts: [],
        hypotheses: [],
        invalidationConditions: [],
        riskContext: { overallLevel: "low", basis: [], categories: [], categoriesUnavailable: [], categoriesWithEvidence: [], dataAvailable: false },
        historicalContext: { status: "insufficient-sample" } as VerifiedAnswerResponse["historicalContext"],
        missingInformation: [],
        presentedBy: "deterministic-fallback",
        generatedAt: "2026-01-01T00:00:00.000Z",
        version: "1.0.0",
      }) as VerifiedAnswerResponse;

    const withZones = buildIntelligencePanelDataFromVerifiedAnswer(fixture({ equalHigh: { price: 1.2, touches: 2 } }));
    assert.deepEqual(withZones.liquidityZones, { equalHigh: { price: 1.2, touches: 2 } });

    const withoutZones = buildIntelligencePanelDataFromVerifiedAnswer(fixture(undefined));
    assert.deepEqual(withoutZones.liquidityZones, {});
  });

  test("10: the legacy CopilotAnalysis pipeline (services/ai/intelligence-panel.service.ts) honestly supplies {} - it has no MarketState.structure to compute a real value from", () => {
    const analysis: CopilotAnalysis = {
      symbol: "EURUSD",
      snapshot: { symbol: "EURUSD", assetClass: "forex", price: 1.1, quoteCurrency: "USD", timestamp: "2026-01-01T00:00:00.000Z", timezone: "UTC", marketStatus: "open", provider: "test" } as MarketSnapshot,
      technical: {
        symbol: "EURUSD",
        interval: "1h",
        candleCount: 40,
        hasSufficientData: true,
        indicators: {},
        keyLevels: {},
        observations: [],
        computedAt: "2026-01-01T00:00:00.000Z",
      } as CopilotAnalysis["technical"],
      risk: { volatility: "low", notes: [], marketStatus: "open" } as CopilotAnalysis["risk"],
      confidence: { band: "high", computed: 7, total: 7 } as CopilotAnalysis["confidence"],
      aiStatus: "completed",
      evidence: [],
    };
    const panel = buildIntelligencePanelData(analysis);
    assert.deepEqual(panel.liquidityZones, {});
  });
}

async function main(): Promise<void> {
  console.log("=== liquidityZones() pure engine ===");
  pureEngineTests();
  console.log("\n=== MarketStateService wiring ===");
  marketStateWiringTests();
  console.log("\n=== Panel pipeline passthrough ===");
  decisionContextPanelPassthroughTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
