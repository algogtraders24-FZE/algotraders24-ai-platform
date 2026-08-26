// scripts/validate-key-levels-engine.ts
// Sprint D2.7.11 (post-completion) - real Key Price Levels
// (Resistance/Support/Invalidation/Breakout/Pullback), reversing the D2.2
// Phase 7 "no invented support/resistance" rule with the user's explicit
// sign-off (2026-08-25), after an investigation confirmed this specific
// gap was a genuinely unbuilt calculation, never a data-provider
// limitation (see project_ai_intelligence_data_gaps_investigation memory).
// Covers the pure engine (lib/market-data/indicators.ts's
// recentPriceRange()/keyPriceLevels()), the TechnicalContextService wiring,
// and the legacy CopilotAnalysis pipeline (services/ai/intelligence-panel.
// service.ts) - the DecisionContext pipeline's own coverage lives in
// validate-intelligence-panel-projection.ts (tests 17/17a-17e), reusing
// the SAME keyPriceLevels() derivation this file tests directly, so the
// two panels can never disagree for the same symbol.
import assert from "node:assert/strict";
import { recentPriceRange, keyPriceLevels, RECENT_RANGE_LOOKBACK_BARS_DEFAULT } from "../lib/market-data/indicators";
import { TechnicalContextService } from "../services/ai/technical-context.service";
import { buildIntelligencePanelData } from "../services/ai/intelligence-panel.service";
import type { Candle } from "../types/market-candle";
import type { CopilotAnalysis } from "../services/ai/trading-copilot.service";
import type { MarketSnapshot } from "../types/market-snapshot";

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

function makeCandles(count: number, base = 100): Candle[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 5) * 4 + i * 0.03;
    const c = o + (i % 4 === 0 ? -1 : 1) * (0.4 + (i % 6));
    const h = Math.max(o, c) + 1.1;
    const l = Math.min(o, c) - 1.1;
    out.push({ datetime: new Date(start + i * 60_000).toISOString(), open: o, high: h, low: l, close: c, volume: 400 + (i % 20) * 12 });
  }
  return out;
}

function recentPriceRangeTests(): void {
  test("1: undefined when there aren't enough candles for a real lookback window - never a fabricated range from too little data", () => {
    assert.equal(recentPriceRange(makeCandles(RECENT_RANGE_LOOKBACK_BARS_DEFAULT)), undefined);
  });

  test("2: a real range is returned once there are enough candles, excluding the latest (still-forming) candle", () => {
    const candles = makeCandles(RECENT_RANGE_LOOKBACK_BARS_DEFAULT + 5);
    const range = recentPriceRange(candles);
    assert.ok(range);
    assert.equal(range!.lookbackBars, RECENT_RANGE_LOOKBACK_BARS_DEFAULT);
    const window = candles.slice(candles.length - 1 - RECENT_RANGE_LOOKBACK_BARS_DEFAULT, candles.length - 1);
    const expectedHigh = Math.max(...window.map((c) => c.high));
    const expectedLow = Math.min(...window.map((c) => c.low));
    assert.equal(range!.high, expectedHigh);
    assert.equal(range!.low, expectedLow);
  });

  test("3: excludes the latest candle from the window - an extreme value ONLY on the latest candle must never move the range", () => {
    const candles = makeCandles(RECENT_RANGE_LOOKBACK_BARS_DEFAULT + 5);
    const withoutSpike = recentPriceRange(candles);
    const spiked = [...candles];
    spiked[spiked.length - 1] = { ...spiked[spiked.length - 1], high: 99999, low: -99999 };
    const withSpike = recentPriceRange(spiked);
    assert.deepEqual(withSpike, withoutSpike);
  });

  test("4: matches services/intelligence/market-state/market-state.service.ts's own BREAKOUT_LOOKBACK_BARS exactly (20) - the same real 'recent range' definition, never a second one", () => {
    assert.equal(RECENT_RANGE_LOOKBACK_BARS_DEFAULT, 20);
  });
}

function keyPriceLevelsTests(): void {
  test("5: {} when there's no real range - never a fabricated level", () => {
    assert.deepEqual(keyPriceLevels(undefined), {});
  });

  test("6: resistance/support are exactly the range's high/low - a real derivation, never invented", () => {
    const levels = keyPriceLevels({ high: 1.165, low: 1.145, lookbackBars: 20 });
    assert.equal(levels.resistance, 1.165);
    assert.equal(levels.support, 1.145);
  });

  test("7: pullback is exactly the standard 61.8% ('golden pocket') Fibonacci retracement between resistance and support - MT5's own real default Fibonacci Retracement ratio (FIBONACCI_LEVELS, lib/chart-engine/drawing/types.ts), applied to a genuine recent high/low", () => {
    const levels = keyPriceLevels({ high: 1.2, low: 1.0, lookbackBars: 20 });
    assert.ok(Math.abs((levels.pullback as number) - (1.2 - 0.2 * 0.618)) < 1e-9);
  });
}

function technicalContextServiceTests(): void {
  const service = new TechnicalContextService();

  test("8: TechnicalContext.keyLevels is {} for too few candles - the real, honest engine output, never a fabricated default", () => {
    const technical = service.build("EURUSD", "1h", makeCandles(10), "2026-08-25T00:00:00.000Z");
    assert.deepEqual(technical.keyLevels, {});
  });

  test("9: TechnicalContext.keyLevels is real once there are enough candles - matches recentPriceRange()/keyPriceLevels() applied to the exact same candles, never a second/drifting computation", () => {
    const candles = makeCandles(40);
    const technical = service.build("EURUSD", "1h", candles, "2026-08-25T00:00:00.000Z");
    const expected = keyPriceLevels(recentPriceRange(candles));
    assert.deepEqual(technical.keyLevels, expected);
  });
}

function legacyPipelineFixture(candles: Candle[]): CopilotAnalysis {
  const service = new TechnicalContextService();
  const technical = service.build("EURUSD", "1h", candles, "2026-08-25T00:00:00.000Z");
  const risk = service.buildRisk(
    { symbol: "EURUSD", assetClass: "forex", price: candles[candles.length - 1].close, quoteCurrency: "USD", timestamp: "2026-08-25T00:00:00.000Z", timezone: "UTC", marketStatus: "open", provider: "test" } as MarketSnapshot,
    technical,
  );
  const confidence = service.confidence(technical);
  return {
    symbol: "EURUSD",
    snapshot: { symbol: "EURUSD", assetClass: "forex", price: candles[candles.length - 1].close, quoteCurrency: "USD", timestamp: "2026-08-25T00:00:00.000Z", timezone: "UTC", marketStatus: "open", provider: "test" } as MarketSnapshot,
    technical,
    risk,
    confidence,
    aiStatus: "completed",
    evidence: [],
  };
}

function legacyPipelineTests(): void {
  test("10: with too few candles, keyLevels' price fields are honestly undefined - never fabricated", () => {
    const panel = buildIntelligencePanelData(legacyPipelineFixture(makeCandles(10)));
    assert.equal(panel.keyLevels.resistance, undefined);
    assert.equal(panel.keyLevels.support, undefined);
  });

  test("11: with enough candles, resistance/support/pullback are real - and match the SAME keyPriceLevels() derivation the DecisionContext pipeline uses (validate-intelligence-panel-projection.ts's tests 17a/17b) - the two panels can never disagree for the same underlying range", () => {
    const candles = makeCandles(40);
    const panel = buildIntelligencePanelData(legacyPipelineFixture(candles));
    const expected = keyPriceLevels(recentPriceRange(candles));
    assert.equal(panel.keyLevels.resistance, expected.resistance);
    assert.equal(panel.keyLevels.support, expected.support);
    assert.equal(panel.keyLevels.pullback, expected.pullback);
  });

  test("12: invalidation/breakout are gated on a real EMA20/EMA50-derived bias, honestly undefined without one (e.g. too few candles for EMA50)", () => {
    // 40 candles is enough for the recent-range (20) but not always enough
    // for EMA50 depending on warm-up - assert the gate itself works by
    // checking a genuinely too-short series never produces a bias.
    const panel = buildIntelligencePanelData(legacyPipelineFixture(makeCandles(10)));
    assert.equal(panel.structure.bias, undefined);
    assert.equal(panel.keyLevels.invalidation, undefined);
    assert.equal(panel.keyLevels.breakout, undefined);
  });

  test("13: with a real bullish bias, invalidation is the real support and breakout is the real resistance", () => {
    // An ACCELERATING rise (quadratic, not linear) - a perfectly linear
    // ramp's MACD histogram flattens toward zero once past warm-up (the
    // fast/slow EMA gap approaches a constant offset with no further
    // acceleration), which can conflict with the trend and force bias to
    // "neutral". Accelerating growth keeps the histogram cleanly positive
    // throughout, matching a genuine "strengthening" bullish read.
    const start = Date.parse("2026-01-01T00:00:00Z");
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const c = 100 + i * i * 0.02;
      return { datetime: new Date(start + i * 60_000).toISOString(), open: c - 0.2, high: c + 0.5, low: c - 0.5, close: c, volume: 500 };
    });
    const panel = buildIntelligencePanelData(legacyPipelineFixture(candles));
    assert.equal(panel.structure.bias, "bullish");
    const expected = keyPriceLevels(recentPriceRange(candles));
    assert.equal(panel.keyLevels.invalidation, expected.support);
    assert.equal(panel.keyLevels.breakout, expected.resistance);
  });
}

async function main(): Promise<void> {
  console.log("=== recentPriceRange() ===");
  recentPriceRangeTests();
  console.log("\n=== keyPriceLevels() ===");
  keyPriceLevelsTests();
  console.log("\n=== TechnicalContextService wiring ===");
  technicalContextServiceTests();
  console.log("\n=== Legacy CopilotAnalysis pipeline (services/ai/intelligence-panel.service.ts) ===");
  legacyPipelineTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
