import { test } from "node:test";
import assert from "node:assert/strict";
import { comparison, indicatorOperand, literal, and, or } from "../src/domain/expression.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import type { MarketState } from "../src/domain/market-state.js";
import { FIXTURE_INSTRUMENT, FIXTURE_TIMEFRAME } from "./fixtures/golden-fixtures.js";

const fast = indicator("EMA", 3);
const slow = indicator("EMA", 8);

function stateWith(current: { fast?: number; slow?: number }, previous?: { fast?: number; slow?: number }): MarketState {
  const currentMap = new Map<string, number | boolean>();
  if (current.fast !== undefined) currentMap.set(indicatorKey(fast), current.fast);
  if (current.slow !== undefined) currentMap.set(indicatorKey(slow), current.slow);

  let previousMap: Map<string, number | boolean> | undefined;
  if (previous) {
    previousMap = new Map<string, number | boolean>();
    if (previous.fast !== undefined) previousMap.set(indicatorKey(fast), previous.fast);
    if (previous.slow !== undefined) previousMap.set(indicatorKey(slow), previous.slow);
  }

  return {
    instrument: FIXTURE_INSTRUMENT,
    timeframe: FIXTURE_TIMEFRAME,
    asOf: 0,
    bars: [],
    indicatorValues: currentMap,
    ...(previousMap !== undefined ? { previousIndicatorValues: previousMap } : {}),
  };
}

const crossAbove = comparison("cross_above", indicatorOperand(fast), indicatorOperand(slow));
const crossBelow = comparison("cross_below", indicatorOperand(fast), indicatorOperand(slow));

test("cross_above: clean upward cross (previous <=, current >) is true", () => {
  const state = stateWith({ fast: 105, slow: 100 }, { fast: 98, slow: 100 });
  assert.equal(evaluateExpression(crossAbove, state), true);
});

test("cross_below: clean downward cross (previous >=, current <) is true", () => {
  const state = stateWith({ fast: 95, slow: 100 }, { fast: 102, slow: 100 });
  assert.equal(evaluateExpression(crossBelow, state), true);
});

test("cross_above: equality transition — previous exactly equal counts as 'at or below'", () => {
  const state = stateWith({ fast: 101, slow: 100 }, { fast: 100, slow: 100 });
  assert.equal(evaluateExpression(crossAbove, state), true);
});

test("cross_below: equality transition — previous exactly equal counts as 'at or above'", () => {
  const state = stateWith({ fast: 99, slow: 100 }, { fast: 100, slow: 100 });
  assert.equal(evaluateExpression(crossBelow, state), true);
});

test("cross_above: no cross when already above on both observations", () => {
  const state = stateWith({ fast: 106, slow: 100 }, { fast: 105, slow: 100 });
  assert.equal(evaluateExpression(crossAbove, state), false);
});

test("cross_above: no cross when still below on both observations", () => {
  const state = stateWith({ fast: 95, slow: 100 }, { fast: 90, slow: 100 });
  assert.equal(evaluateExpression(crossAbove, state), false);
});

test("cross_above: first observation (no previousIndicatorValues at all) is defined false, not an error", () => {
  const state = stateWith({ fast: 105, slow: 100 }, undefined);
  assert.equal(evaluateExpression(crossAbove, state), false);
});

test("cross_below: insufficient history (previous map present but missing this indicator's key) is defined false", () => {
  const state = stateWith({ fast: 95, slow: 100 }, { slow: 100 }); // previous fast missing
  assert.equal(evaluateExpression(crossBelow, state), false);
});

test("cross_above against a literal: previous/current literal value is constant, so only the indicator side matters", () => {
  const expr = comparison("cross_above", indicatorOperand(fast), literal(100));
  const state = stateWith({ fast: 105 }, { fast: 98 });
  assert.equal(evaluateExpression(expr, state), true);
});

test("repeated evaluation of the same cross expression against the same state is deterministic", () => {
  const state = stateWith({ fast: 105, slow: 100 }, { fast: 98, slow: 100 });
  const results = Array.from({ length: 5 }, () => evaluateExpression(crossAbove, state));
  assert.ok(results.every((r) => r === true));
});

test("cross expressions work nested inside AND/OR", () => {
  const state = stateWith({ fast: 105, slow: 100 }, { fast: 98, slow: 100 });
  const nested = and(crossAbove, comparison(">", literal(2), literal(1)));
  assert.equal(evaluateExpression(nested, state), true);

  const nestedOr = or(crossBelow, crossAbove);
  assert.equal(evaluateExpression(nestedOr, state), true);
});

test("cross_above and cross_below on the same crossing observation are mutually exclusive", () => {
  const upState = stateWith({ fast: 105, slow: 100 }, { fast: 98, slow: 100 });
  assert.equal(evaluateExpression(crossAbove, upState), true);
  assert.equal(evaluateExpression(crossBelow, upState), false);
});

test("deterministic repeated execution across freshly-constructed identical states", () => {
  const build = () => stateWith({ fast: 105, slow: 100 }, { fast: 98, slow: 100 });
  const results = Array.from({ length: 5 }, () => evaluateExpression(crossAbove, build()));
  assert.ok(results.every((r) => r === results[0]));
});
