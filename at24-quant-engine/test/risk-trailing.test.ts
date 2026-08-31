import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import type { TrailingStopRule } from "../src/domain/risk-specification.js";

const rule: TrailingStopRule = { activation: { mode: "absolute", value: 2 }, distance: { mode: "absolute", value: 1 } };

test("before activation: no trailing action", () => {
  const result = evaluateTrailingStop(rule, "BUY", 100, 101, undefined, undefined);
  assert.equal(result.triggered, false);
});

test("at activation with no existing stop: proposes currentPrice - distance (BUY)", () => {
  const result = evaluateTrailingStop(rule, "BUY", 100, 102, undefined, undefined);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 101);
});

test("SELL: proposes currentPrice + distance", () => {
  const result = evaluateTrailingStop(rule, "SELL", 100, 98, undefined, undefined);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 99);
});

test("INVARIANT: a trailing stop cannot move backward (BUY) — a worse proposed stop is rejected as no-op", () => {
  // current stop already at 103; naive trail computes 104-1=103 (not an improvement, equal) -> no trigger
  const result = evaluateTrailingStop(rule, "BUY", 100, 104, 103, undefined);
  assert.equal(result.triggered, false);
});

test("trailing DOES move the stop when the new value strictly improves it (BUY)", () => {
  const result = evaluateTrailingStop(rule, "BUY", 100, 110, 103, undefined);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 109);
  assert.ok(result.newStopPrice! > 103);
});

test("INVARIANT: a trailing stop cannot move backward (SELL)", () => {
  const result = evaluateTrailingStop(rule, "SELL", 100, 96, 97, undefined); // naive trail = 96+1=97, not better than 97
  assert.equal(result.triggered, false);
});

test("price retracing after having trailed further does not move the stop backward", () => {
  // Simulate two calls: first at price 110 (stop moves to 109), then price retraces to 105
  const first = evaluateTrailingStop(rule, "BUY", 100, 110, 103, undefined);
  assert.equal(first.newStopPrice, 109);
  const second = evaluateTrailingStop(rule, "BUY", 100, 105, first.newStopPrice, undefined);
  // naive trail at 105 = 104, which is WORSE than 109 -> must not trigger
  assert.equal(second.triggered, false);
});

test("an invalid currentPrice produces a deterministic violation", () => {
  const result = evaluateTrailingStop(rule, "BUY", 100, -5, undefined, undefined);
  assert.equal(result.triggered, false);
  assert.equal(result.violation!.code, "TRAILING_CONSTRAINT");
});

test("an atr-multiple distance without a supplied ATR value is a deterministic violation, not a throw", () => {
  const atrRule: TrailingStopRule = { activation: { mode: "absolute", value: 1 }, distance: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 } };
  const result = evaluateTrailingStop(atrRule, "BUY", 100, 102, undefined, undefined);
  assert.equal(result.violation!.code, "TRAILING_CONSTRAINT");
  assert.equal(result.violation!.reason, "MISSING_REQUIRED_VALUE");
});

test("repeated evaluation of the same input is deterministic", () => {
  const run = () => evaluateTrailingStop(rule, "BUY", 100, 110, 103, undefined);
  assert.deepEqual(run(), run());
});
