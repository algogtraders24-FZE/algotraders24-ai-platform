// scripts/validate-market-state.ts
// Sprint D2.5.2 - Standalone validation for MarketStateService. No test
// framework exists in this project; run via `npm run validate:market-state`.
// Pure in-memory (no database, no network) - MarketStateService performs
// no I/O, so every case here is a synchronous, deterministic function call
// over hand-built candle fixtures.
import assert from "node:assert/strict";
import { MarketStateService, INTELLIGENCE_ENGINE_VERSION } from "../services/intelligence/market-state/market-state.service";
import type { Candle } from "../types/market-candle";
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

function snapshotFor(candles: Candle[], symbol = "EURUSD"): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol,
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

// A steadily-rising 76-bar close series with enough candles for every
// tracked indicator (EMA50 needs >=50, MACD needs >=35, Bollinger/ATR/RSI
// need >=20/15/15).
function fullDataCloses(): number[] {
  const arr: number[] = [];
  for (let i = 0; i < 76; i++) arr.push(1.1 + i * 0.0003);
  return arr;
}

const service = new MarketStateService();

function main(): void {
  // ---- valid snapshot / full data ----
  test("assemble() with ample candles computes all 7 tracked indicators", () => {
    const candles = makeCandles(fullDataCloses());
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.equal(state.dataQuality.band, "high");
    assert.equal(state.dataQuality.computed, 7);
    assert.equal(state.dataQuality.total, 7);
    assert.ok(state.technical?.rsi14 !== undefined);
    assert.ok(state.technical?.ema20 !== undefined);
    assert.ok(state.technical?.ema50 !== undefined);
    assert.ok(state.technical?.atr14 !== undefined);
    assert.ok(state.technical?.macd !== undefined);
    assert.ok(state.technical?.bollinger !== undefined);
    assert.ok(state.technical?.volume !== undefined);
  });

  test("assemble() echoes the real symbol/timeframe/snapshot through unchanged", () => {
    const candles = makeCandles(fullDataCloses());
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "4h", snapshot, candles });
    assert.equal(state.symbol, "EURUSD");
    assert.equal(state.timeframe, "4h");
    assert.equal(state.snapshot, snapshot, "the real snapshot object must be carried through, not rebuilt");
  });

  // ---- insufficient data ----
  test("assemble() with 3 candles leaves EMA/ATR/MACD/Bollinger undefined - never estimated", () => {
    const candles = makeCandles([1.1, 1.1005, 1.101]);
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.equal(state.technical?.ema20, undefined);
    assert.equal(state.technical?.ema50, undefined);
    assert.equal(state.technical?.atr14, undefined);
    assert.equal(state.technical?.macd, undefined);
    assert.equal(state.technical?.bollinger, undefined);
    assert.equal(state.structure?.trend?.direction, undefined);
    assert.equal(state.structure?.recentRange, undefined);
    assert.equal(state.structure?.volatilityBand, undefined);
    assert.equal(state.dataQuality.band, "low", "volume is still computable from 3 candles, so this is 'low', not the impossible 'insufficient' with zero computed");
  });

  test("assemble() with truly zero candles marks dataQuality as insufficient", () => {
    const candles: Candle[] = [];
    // A snapshot can still exist even with no time-series history.
    const snapshot: MarketSnapshot = {
      symbol: "EURUSD",
      assetClass: "forex",
      price: 1.1,
      quoteCurrency: "USD",
      timestamp: new Date().toISOString(),
      timezone: "UTC",
      marketStatus: "open",
      provider: "test-fixture",
      retrievedAt: new Date().toISOString(),
    };
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.equal(state.dataQuality.band, "insufficient");
    assert.equal(state.dataQuality.computed, 0);
    assert.equal(state.structure?.trend?.direction, undefined);
  });

  // ---- missing optional indicators / undefined propagation ----
  test("volume is undefined when no candle carries a volume figure - never fabricated as 0", () => {
    const candles = makeCandles(fullDataCloses()).map((c) => {
      const rest: Partial<Candle> = { ...c };
      delete rest.volume;
      return rest as Candle;
    });
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.equal(state.technical?.volume, undefined);
    assert.equal(state.dataQuality.computed, 6, "6/7 - every indicator except volume should still compute");
  });

  test("structure.volumeDelta/bos/choch remain always undefined - genuinely no data source exists; structure.liquidityZones is now REAL (SMC Equal High/Low, post-completion 2026-08-26) but honestly {} when no real cluster exists in this fixture's candles", () => {
    const candles = makeCandles(fullDataCloses());
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.deepEqual(state.structure?.liquidityZones, { equalHigh: undefined, equalLow: undefined });
    assert.equal(state.structure?.volumeDelta, undefined);
    assert.equal(state.structure?.bos, undefined);
    assert.equal(state.structure?.choch, undefined);
  });

  test("MarketState has no `quant` or `context` field at all in D2.5.2", () => {
    const candles = makeCandles(fullDataCloses());
    const snapshot = snapshotFor(candles);
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    assert.equal((state as unknown as Record<string, unknown>).quant, undefined);
    assert.equal((state as unknown as Record<string, unknown>).context, undefined);
  });

  // ---- basis / provenance ----
  test("trend always carries a non-empty, human-readable basis", () => {
    const full = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(makeCandles(fullDataCloses())), candles: makeCandles(fullDataCloses()) });
    const sparse = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(makeCandles([1.1, 1.1005])), candles: makeCandles([1.1, 1.1005]) });
    assert.ok(full.structure?.trend?.basis.length ?? 0 > 0);
    assert.ok(sparse.structure?.trend?.basis.length ?? 0 > 0, "even the 'unavailable' case must state why, not just be silent");
  });

  test("dataQuality.note is a real, specific sentence, not a generic placeholder", () => {
    const candles = makeCandles(fullDataCloses());
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
    assert.match(state.dataQuality.note, /\d+\/7 tracked indicators/);
  });

  // ---- versioning ----
  test("pipelineVersion is the Intelligence Engine V2 version, not the 15D pipeline version", () => {
    const candles = makeCandles(fullDataCloses());
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
    assert.equal(state.pipelineVersion, INTELLIGENCE_ENGINE_VERSION);
    assert.equal(INTELLIGENCE_ENGINE_VERSION, "2.0.0");
    assert.notEqual(state.pipelineVersion, "15D.12.0");
  });

  test("generatedAt is a real, parseable ISO timestamp", () => {
    const candles = makeCandles(fullDataCloses());
    const state = service.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
    assert.ok(!Number.isNaN(Date.parse(state.generatedAt)));
  });

  // ---- structural boundary: no LLM/AI import anywhere in this service ----
  test("market-state.service.ts imports nothing from lib/ai or the Gemini SDK", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../services/intelligence/market-state/market-state.service.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["']@\/lib\/ai/);
    assert.doesNotMatch(source, /@google\/genai/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
