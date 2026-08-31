import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesOperand, comparison, indicatorOperand, validateExpression } from "../src/domain/expression.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { validateSeriesOffset, seriesOffset } from "../src/domain/strategy-ir/series.js";
import { indicator } from "../src/domain/indicator-reference.js";
import type { MarketState } from "../src/domain/market-state.js";
import type { OHLCVBar, Instrument, Timeframe } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "SERIESTEST" };
const TIMEFRAME: Timeframe = "H1";

function bar(ts: number, close: number): OHLCVBar {
  return { timestamp: ts, instrument: INSTRUMENT, timeframe: TIMEFRAME, open: close, high: close, low: close, close, volume: 1 };
}

test("Q0.7.9: validateSeriesOffset rejects negative (future) offsets", () => {
  assert.equal(validateSeriesOffset(seriesOffset("CLOSE", 0)), true);
  assert.equal(validateSeriesOffset(seriesOffset("CLOSE", 5)), true);
  assert.equal(validateSeriesOffset(seriesOffset("CLOSE", -1)), false);
  assert.equal(validateSeriesOffset(seriesOffset("CLOSE", 1.5)), false);
});

test("Q0.7.9: validateExpression rejects a comparison built with a negative series offset", () => {
  const expr = comparison(">", seriesOperand("CLOSE", -1), seriesOperand("CLOSE", 0));
  const result = validateExpression(expr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /future offsets are rejected/);
});

test("Q0.7.8: Close[0] resolves to the current bar's close; Close[1] resolves to the previous bar's close", () => {
  const bars = [bar(1000, 100), bar(2000, 105), bar(3000, 110)];
  const state: MarketState = { instrument: INSTRUMENT, timeframe: TIMEFRAME, asOf: 3000, bars, indicatorValues: new Map() };
  const exprCurrent = comparison("==", seriesOperand("CLOSE", 0), seriesOperand("CLOSE", 0));
  assert.equal(evaluateExpression(exprCurrent, state), true);

  const exprPrev = comparison(">", seriesOperand("CLOSE", 0), seriesOperand("CLOSE", 1));
  assert.equal(evaluateExpression(exprPrev, state), true); // 110 > 105
});

test("Q0.7.8: an offset with insufficient history throws a clear error, never a silent 0/undefined", () => {
  const bars = [bar(1000, 100)];
  const state: MarketState = { instrument: INSTRUMENT, timeframe: TIMEFRAME, asOf: 1000, bars, indicatorValues: new Map() };
  const expr = comparison(">", seriesOperand("CLOSE", 5), seriesOperand("CLOSE", 0));
  assert.throws(() => evaluateExpression(expr, state), /not enough history/);
});

test("Q0.7.6: a RESERVED series field (e.g. BID) throws a clear, distinct error when actually evaluated — never silently returns 0", () => {
  const bars = [bar(1000, 100)];
  const state: MarketState = { instrument: INSTRUMENT, timeframe: TIMEFRAME, asOf: 1000, bars, indicatorValues: new Map() };
  const expr = comparison(">", seriesOperand("BID", 0), seriesOperand("CLOSE", 0));
  assert.throws(() => evaluateExpression(expr, state), /RESERVED field/);
});

test("Q0.7.10: cross semantics (Q0.2, unchanged) still work identically for indicator operands after the Operand extension", () => {
  const emaFast = indicator("EMA", 5);
  const emaSlow = indicator("EMA", 20);
  const state: MarketState = {
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    asOf: 2000,
    bars: [bar(1000, 100), bar(2000, 101)],
    indicatorValues: new Map([[`EMA(5)`, 10], [`EMA(20)`, 8]]),
    previousIndicatorValues: new Map([[`EMA(5)`, 7], [`EMA(20)`, 9]]),
  };
  const crossAbove = comparison("cross_above", indicatorOperand(emaFast), indicatorOperand(emaSlow));
  assert.equal(evaluateExpression(crossAbove, state), true); // prev 7<=9, current 10>8
});
