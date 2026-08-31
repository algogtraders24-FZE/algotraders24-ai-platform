import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSeries } from "../src/runtime/indicator-engine.js";
import { sma } from "../src/indicators/sma.js";
import { ema } from "../src/indicators/ema.js";
import { rsi } from "../src/indicators/rsi.js";
import { atr } from "../src/indicators/atr.js";
import { macd } from "../src/indicators/macd.js";
import { bollinger } from "../src/indicators/bollinger.js";
import { FIXTURE_CONSTANT, FIXTURE_TREND, FIXTURE_RANGE } from "./fixtures/golden-fixtures.js";
import type { OHLCVBar } from "../src/domain/market-data.js";
import { referenceSma, referenceEma, referenceRsi, referenceAtr, referenceMacd, referenceBollinger } from "./reference/indicator-reference.js";

const TOLERANCE = 1e-9;

function closeEnough(a: number, b: number, tolerance = TOLERANCE): void {
  assert.ok(Math.abs(a - b) < tolerance, `expected ${a} ~= ${b}`);
}

function closesOf(bars: readonly OHLCVBar[]): readonly number[] {
  return bars.map((b) => b.close);
}

// ---- SMA: known sequence, hand-verified ----
test("SMA(3) matches a hand-computed known sequence", () => {
  const bars = [1, 2, 3, 4, 5].map((c, i) => ({ ...FIXTURE_TREND.bars[0]!, close: c, timestamp: i }));
  const out = calculateSeries(sma, bars, { period: 3 });
  assert.deepEqual(out, [null, null, 2, 3, 4]);
});

test("SMA warmup: first (period-1) outputs are null, first non-null at index period-1", () => {
  const out = calculateSeries(sma, FIXTURE_TREND.bars, { period: 5 });
  assert.equal(out.slice(0, 4).every((v) => v === null), true);
  assert.notEqual(out[4], null);
});

// ---- EMA: known sequence, hand-verified ----
test("EMA(3) matches a hand-computed known sequence", () => {
  const closes = [10, 10, 10, 10, 10, 20, 20, 20];
  const bars = closes.map((c, i) => ({ ...FIXTURE_TREND.bars[0]!, close: c, timestamp: i }));
  const out = calculateSeries(ema, bars, { period: 3 });
  // seed at index2 = avg(10,10,10)=10; k=0.5
  assert.deepEqual(out.slice(0, 5), [null, null, 10, 10, 10]);
  closeEnough(out[5]!, 15);
  closeEnough(out[6]!, 17.5);
  closeEnough(out[7]!, 18.75);
});

test("EMA on a constant series converges immediately to the constant", () => {
  const out = calculateSeries(ema, FIXTURE_CONSTANT.bars, { period: 5 });
  const defined = out.filter((v): v is number => v !== null);
  for (const v of defined) closeEnough(v, 100);
});

// ---- RSI ----
test("RSI(3) matches a hand-computed known sequence", () => {
  const closes = [1, 2, 3, 2, 1, 2, 3, 4];
  const bars = closes.map((c, i) => ({ ...FIXTURE_TREND.bars[0]!, close: c, timestamp: i }));
  const out = calculateSeries(rsi, bars, { period: 3 });
  // changes: [1,1,-1,-1,1,1,1]; first 3 changes seed avgGain/avgLoss
  closeEnough(out[3]!, 66.66666666666667, 1e-6);
});

test("RSI on a fully flat series is defined as 50 (not NaN)", () => {
  const out = calculateSeries(rsi, FIXTURE_CONSTANT.bars, { period: 5 });
  const defined = out.filter((v): v is number => v !== null);
  assert.ok(defined.length > 0);
  for (const v of defined) assert.equal(v, 50);
});

test("RSI stays within [0, 100] on a monotonic uptrend", () => {
  const out = calculateSeries(rsi, FIXTURE_TREND.bars, { period: 14 });
  for (const v of out) {
    if (v !== null) {
      assert.ok(v >= 0 && v <= 100);
    }
  }
});

// ---- ATR ----
test("ATR on a zero-range constant series is 0", () => {
  const out = calculateSeries(atr, FIXTURE_CONSTANT.bars, { period: 5 });
  const defined = out.filter((v): v is number => v !== null);
  assert.ok(defined.length > 0);
  for (const v of defined) assert.equal(v, 0);
});

test("ATR is always >= 0", () => {
  const out = calculateSeries(atr, FIXTURE_RANGE.bars, { period: 14 });
  for (const v of out) {
    if (v !== null) assert.ok(v >= 0);
  }
});

// ---- Cross-check against independent reference implementations ----
for (const [name, fixture] of [
  ["FIXTURE_TREND", FIXTURE_TREND],
  ["FIXTURE_RANGE", FIXTURE_RANGE],
] as const) {
  test(`SMA(5) production output matches the independent reference implementation on ${name}`, () => {
    const production = calculateSeries(sma, fixture.bars, { period: 5 });
    const reference = referenceSma(closesOf(fixture.bars), 5);
    production.forEach((v, i) => (v === null ? assert.equal(reference[i], null) : closeEnough(v, reference[i]!)));
  });

  test(`EMA(8) production output matches the independent reference implementation on ${name}`, () => {
    const production = calculateSeries(ema, fixture.bars, { period: 8 });
    const reference = referenceEma(closesOf(fixture.bars), 8);
    production.forEach((v, i) => (v === null ? assert.equal(reference[i], null) : closeEnough(v, reference[i]!)));
  });

  test(`RSI(7) production output matches the independent reference implementation on ${name}`, () => {
    const production = calculateSeries(rsi, fixture.bars, { period: 7 });
    const reference = referenceRsi(closesOf(fixture.bars), 7);
    production.forEach((v, i) => (v === null ? assert.equal(reference[i], null) : closeEnough(v, reference[i]!, 1e-6)));
  });

  test(`ATR(10) production output matches the independent reference implementation on ${name}`, () => {
    const production = calculateSeries(atr, fixture.bars, { period: 10 });
    const reference = referenceAtr(fixture.bars, 10);
    production.forEach((v, i) => (v === null ? assert.equal(reference[i], null) : closeEnough(v, reference[i]!, 1e-6)));
  });

  test(`MACD(3,6,4) production output matches the independent reference implementation on ${name}`, () => {
    // Short periods so the fixtures' 30 bars actually reach defined output
    // (a standard 12/26/9 MACD would stay null for the whole fixture).
    const production = calculateSeries(macd, fixture.bars, { fastPeriod: 3, slowPeriod: 6, signalPeriod: 4 });
    const reference = referenceMacd(closesOf(fixture.bars), 3, 6, 4);
    production.forEach((v, i) => {
      if (v === null) {
        assert.equal(reference[i], null);
      } else {
        closeEnough(v.line, reference[i]!.line, 1e-6);
        closeEnough(v.signal, reference[i]!.signal, 1e-6);
        closeEnough(v.histogram, reference[i]!.histogram, 1e-6);
      }
    });
  });

  test(`Bollinger(20,2) production output matches the independent reference implementation on ${name}`, () => {
    const production = calculateSeries(bollinger, fixture.bars, { period: 20, stdDevMultiplier: 2 });
    const reference = referenceBollinger(closesOf(fixture.bars), 20, 2);
    production.forEach((v, i) => {
      if (v === null) {
        assert.equal(reference[i], null);
      } else {
        closeEnough(v.upper, reference[i]!.upper, 1e-6);
        closeEnough(v.middle, reference[i]!.middle, 1e-6);
        closeEnough(v.lower, reference[i]!.lower, 1e-6);
      }
    });
  });
}

// ---- Insufficient history / missing data ----
test("all indicators output null for every bar when there are fewer bars than warmup requires", () => {
  const shortBars = FIXTURE_TREND.bars.slice(0, 2);
  assert.ok(calculateSeries(sma, shortBars, { period: 20 }).every((v) => v === null));
  assert.ok(calculateSeries(ema, shortBars, { period: 20 }).every((v) => v === null));
  assert.ok(calculateSeries(rsi, shortBars, { period: 20 }).every((v) => v === null));
  assert.ok(calculateSeries(atr, shortBars, { period: 20 }).every((v) => v === null));
  assert.ok(calculateSeries(macd, shortBars, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).every((v) => v === null));
  assert.ok(calculateSeries(bollinger, shortBars, { period: 20, stdDevMultiplier: 2 }).every((v) => v === null));
});

// ---- Determinism / repeated calculation ----
test("repeated calculateSeries calls on identical input produce byte-identical output", () => {
  const run1 = calculateSeries(ema, FIXTURE_RANGE.bars, { period: 6 });
  const run2 = calculateSeries(ema, FIXTURE_RANGE.bars, { period: 6 });
  assert.deepEqual(run1, run2);
});

// ---- Parameter changes ----
test("different SMA periods produce different, correctly-shorter/longer warmup output", () => {
  const short = calculateSeries(sma, FIXTURE_TREND.bars, { period: 3 });
  const long = calculateSeries(sma, FIXTURE_TREND.bars, { period: 10 });
  assert.notDeepEqual(short, long);
  assert.equal(short.filter((v) => v === null).length, 2);
  assert.equal(long.filter((v) => v === null).length, 9);
});

// ---- Monotonic input ----
test("SMA and EMA are non-decreasing on a strictly monotonic uptrend once warmed", () => {
  const smaOut = calculateSeries(sma, FIXTURE_TREND.bars, { period: 5 }).filter((v): v is number => v !== null);
  const emaOut = calculateSeries(ema, FIXTURE_TREND.bars, { period: 5 }).filter((v): v is number => v !== null);
  for (let i = 1; i < smaOut.length; i++) assert.ok(smaOut[i]! >= smaOut[i - 1]!);
  for (let i = 1; i < emaOut.length; i++) assert.ok(emaOut[i]! >= emaOut[i - 1]!);
});

// ---- Warmup metadata matches actual behavior ----
test("declared warmup.bars matches the index of the first non-null output for every indicator", () => {
  const smaWarmup = sma.warmup({ period: 7 }).bars;
  const smaOut = calculateSeries(sma, FIXTURE_TREND.bars, { period: 7 });
  assert.equal(smaOut.findIndex((v) => v !== null), smaWarmup - 1);

  const rsiWarmup = rsi.warmup({ period: 7 }).bars;
  const rsiOut = calculateSeries(rsi, FIXTURE_TREND.bars, { period: 7 });
  assert.equal(rsiOut.findIndex((v) => v !== null), rsiWarmup - 1);

  const longBars = Array.from({ length: 50 }, (_, i) => ({ ...FIXTURE_TREND.bars[0]!, close: 100 + i, timestamp: i }));
  const macdWarmup = macd.warmup({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).bars;
  const macdOut = calculateSeries(macd, longBars, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
  assert.equal(macdOut.findIndex((v) => v !== null), macdWarmup - 1);
});
