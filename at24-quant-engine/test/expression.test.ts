import { test } from "node:test";
import assert from "node:assert/strict";
import { and, or, not, comparison, indicatorOperand, literal, booleanReference, validateExpression } from "../src/domain/expression.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { indicator } from "../src/domain/indicator-reference.js";
import { buildMarketState, ema20, ema50, rsi14 } from "./fixtures.js";

test("comparison operators evaluate correctly", () => {
  const state = buildMarketState({ ema20: 2400, ema50: 2380 });
  const cases: Array<[">" | ">=" | "<" | "<=" | "==" | "!=", boolean]> = [
    [">", true],
    [">=", true],
    ["<", false],
    ["<=", false],
    ["==", false],
    ["!=", true],
  ];
  for (const [operator, expected] of cases) {
    const expr = comparison(operator, indicatorOperand(ema20), indicatorOperand(ema50));
    assert.equal(evaluateExpression(expr, state), expected, `operator ${operator}`);
  }
});

test("AND requires all operands true", () => {
  const state = buildMarketState({ ema20: 2400, ema50: 2380, rsi14: 60 });
  const trueExpr = comparison(">", indicatorOperand(ema20), indicatorOperand(ema50));
  const falseExpr = comparison("<", indicatorOperand(rsi14), literal(50));
  assert.equal(evaluateExpression(and(trueExpr, trueExpr), state), true);
  assert.equal(evaluateExpression(and(trueExpr, falseExpr), state), false);
});

test("OR requires at least one operand true", () => {
  const state = buildMarketState();
  const trueExpr = comparison(">", literal(2), literal(1));
  const falseExpr = comparison("<", literal(2), literal(1));
  assert.equal(evaluateExpression(or(falseExpr, trueExpr), state), true);
  assert.equal(evaluateExpression(or(falseExpr, falseExpr), state), false);
});

test("NOT inverts its single operand", () => {
  const state = buildMarketState();
  const trueExpr = comparison(">", literal(2), literal(1));
  assert.equal(evaluateExpression(not(trueExpr), state), false);
  assert.equal(evaluateExpression(not(not(trueExpr)), state), true);
});

test("nested expressions evaluate per standard boolean precedence", () => {
  // (EMA20 > EMA50 AND RSI14 > 55) OR (Breakout == true)
  const state = buildMarketState({ ema20: 2350, ema50: 2380, rsi14: 40 });
  const breakout = indicator("BREAKOUT");
  const stateWithBreakout = {
    ...state,
    indicatorValues: new Map([...state.indicatorValues, ["BREAKOUT()", true]]),
  };
  const expr = or(
    and(comparison(">", indicatorOperand(ema20), indicatorOperand(ema50)), comparison(">", indicatorOperand(rsi14), literal(55))),
    booleanReference(breakout),
  );
  assert.equal(evaluateExpression(expr, stateWithBreakout), true);

  const stateWithoutBreakout = {
    ...state,
    indicatorValues: new Map([...state.indicatorValues, ["BREAKOUT()", false]]),
  };
  assert.equal(evaluateExpression(expr, stateWithoutBreakout), false);
});

test("validateExpression rejects NOT with wrong arity", () => {
  const result = validateExpression({ type: "logical", operator: "NOT", operands: [] });
  assert.equal(result.valid, false);
});

test("validateExpression rejects AND with fewer than 2 operands", () => {
  const single = comparison(">", literal(1), literal(0));
  const result = validateExpression({ type: "logical", operator: "AND", operands: [single] });
  assert.equal(result.valid, false);
});

test("validateExpression recurses into nested logical expressions", () => {
  const badNested = not({ type: "logical", operator: "AND", operands: [] } as any);
  const result = validateExpression(badNested);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("operands[0]")));
});

test("evaluateExpression throws a descriptive error when an indicator value is missing", () => {
  const state = buildMarketState();
  const missing = indicator("MACD", 12, 26, 9);
  const expr = comparison(">", indicatorOperand(missing), literal(0));
  assert.throws(() => evaluateExpression(expr, state), /MACD\(12,26,9\)/);
});
