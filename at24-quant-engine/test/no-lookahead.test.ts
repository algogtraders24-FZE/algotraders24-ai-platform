import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSeries } from "../src/runtime/indicator-engine.js";
import type { IndicatorDefinition } from "../src/domain/indicator.js";
import { sma } from "../src/indicators/sma.js";
import { ema } from "../src/indicators/ema.js";
import { rsi } from "../src/indicators/rsi.js";
import { atr } from "../src/indicators/atr.js";
import { macd } from "../src/indicators/macd.js";
import { bollinger } from "../src/indicators/bollinger.js";
import { FIXTURE_TREND } from "./fixtures/golden-fixtures.js";

/**
 * Q0.2.5's mandatory architectural safety test: an indicator's value at
 * time T must never change because bars AFTER T were appended to the
 * series. This is proven generically for all six indicators, not just
 * asserted for one, since it is a property of `calculateSeries()`'s fold
 * (see indicator-engine.ts) — but it is proven empirically here rather
 * than only argued structurally, per the sprint's explicit requirement.
 */

const T = 20; // cut point within FIXTURE_TREND's 30 bars

function assertNoLookahead<TParams>(def: IndicatorDefinition<TParams, any, any>, params: TParams): void {
  const through = FIXTURE_TREND.bars.slice(0, T + 1);
  const extended = FIXTURE_TREND.bars.slice(0, T + 4); // through + T+1, T+2, T+3

  const outputThrough = calculateSeries(def, through, params);
  const outputExtended = calculateSeries(def, extended, params);

  assert.deepEqual(outputExtended.slice(0, T + 1), outputThrough, `${def.name}: values through T must be unaffected by future bars`);
}

test("SMA: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(sma, { period: 5 });
});

test("EMA: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(ema, { period: 5 });
});

test("RSI: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(rsi, { period: 7 });
});

test("ATR: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(atr, { period: 7 });
});

test("MACD: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(macd, { fastPeriod: 3, slowPeriod: 6, signalPeriod: 4 });
});

test("Bollinger: appending future bars does not alter previously calculated historical values", () => {
  assertNoLookahead(bollinger, { period: 10, stdDevMultiplier: 2 });
});

test("TimeFrontier-gated indicator calculation matches the same-cut plain calculation (no leakage through the frontier)", async () => {
  const { TimeFrontier } = await import("../src/runtime/time-frontier.js");
  const series = { instrument: FIXTURE_TREND.instrument, timeframe: FIXTURE_TREND.timeframe, bars: FIXTURE_TREND.bars };
  const frontier = new TimeFrontier(series);
  frontier.advanceTo(FIXTURE_TREND.bars[T]!.timestamp);

  const viaFrontier = calculateSeries(sma, frontier.availableBars(), { period: 5 });
  const viaDirectCut = calculateSeries(sma, FIXTURE_TREND.bars.slice(0, T + 1), { period: 5 });
  assert.deepEqual(viaFrontier, viaDirectCut);
});
