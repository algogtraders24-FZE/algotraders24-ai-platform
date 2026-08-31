import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMarketSeries, detectTimestampGaps, iterateChronologically } from "../src/domain/market-series.js";
import {
  FIXTURE_TREND,
  FIXTURE_DUPLICATES,
  FIXTURE_MISSING_DATA,
  FIXTURE_INSTRUMENT,
  FIXTURE_TIMEFRAME,
} from "./fixtures/golden-fixtures.js";

test("a well-formed series (FIXTURE_TREND) validates successfully", () => {
  const result = validateMarketSeries(FIXTURE_TREND);
  assert.equal(result.valid, true);
});

test("duplicate timestamps are detected", () => {
  const result = validateMarketSeries(FIXTURE_DUPLICATES);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate timestamp")));
});

test("out-of-order timestamps are detected", () => {
  const shuffled = { ...FIXTURE_TREND, bars: [FIXTURE_TREND.bars[1]!, FIXTURE_TREND.bars[0]!, ...FIXTURE_TREND.bars.slice(2)] };
  const result = validateMarketSeries(shuffled);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("chronological order violated")));
});

test("invalid OHLC (high < low) is detected", () => {
  const bad = { ...FIXTURE_TREND, bars: [{ ...FIXTURE_TREND.bars[0]!, high: 90, low: 100 }, ...FIXTURE_TREND.bars.slice(1)] };
  const result = validateMarketSeries(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("high") && e.includes("low")));
});

test("open outside [low, high] is detected", () => {
  const bad = { ...FIXTURE_TREND, bars: [{ ...FIXTURE_TREND.bars[0]!, open: 9999 }, ...FIXTURE_TREND.bars.slice(1)] };
  const result = validateMarketSeries(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("open")));
});

test("close outside [low, high] is detected", () => {
  const bad = { ...FIXTURE_TREND, bars: [{ ...FIXTURE_TREND.bars[0]!, close: -1 }, ...FIXTURE_TREND.bars.slice(1)] };
  const result = validateMarketSeries(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("close")));
});

test("negative volume is detected", () => {
  const bad = { ...FIXTURE_TREND, bars: [{ ...FIXTURE_TREND.bars[0]!, volume: -5 }, ...FIXTURE_TREND.bars.slice(1)] };
  const result = validateMarketSeries(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("volume")));
});

test("a bar whose instrument/timeframe does not match the series is detected", () => {
  const bad = {
    ...FIXTURE_TREND,
    bars: [{ ...FIXTURE_TREND.bars[0]!, instrument: { symbol: "OTHER" } }, ...FIXTURE_TREND.bars.slice(1)],
  };
  const result = validateMarketSeries(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("instrument")));
});

test("detectTimestampGaps finds the missing bar in FIXTURE_MISSING_DATA without failing validation", () => {
  // A data gap is not an ordering/OHLC defect, so validation still passes.
  assert.equal(validateMarketSeries(FIXTURE_MISSING_DATA).valid, true);

  const gaps = detectTimestampGaps(FIXTURE_MISSING_DATA, 3_600_000);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.actualIntervalMs, 2 * 3_600_000);
});

test("detectTimestampGaps finds nothing on a fixture with no gaps", () => {
  assert.deepEqual(detectTimestampGaps(FIXTURE_TREND, 3_600_000), []);
});

test("iterateChronologically yields bars in the same order as the underlying array, deterministically", () => {
  const once = [...iterateChronologically(FIXTURE_TREND)];
  const twice = [...iterateChronologically(FIXTURE_TREND)];
  assert.deepEqual(once, FIXTURE_TREND.bars);
  assert.deepEqual(once, twice);
});

test("an empty series validates successfully (no bars to violate any rule)", () => {
  const empty = { instrument: FIXTURE_INSTRUMENT, timeframe: FIXTURE_TIMEFRAME, bars: [] };
  assert.equal(validateMarketSeries(empty).valid, true);
});
