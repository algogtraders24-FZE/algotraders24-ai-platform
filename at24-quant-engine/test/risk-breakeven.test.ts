import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateBreakeven } from "../src/runtime/risk/breakeven.js";
import type { BreakevenRule } from "../src/domain/risk-specification.js";

const rule: BreakevenRule = { trigger: { mode: "absolute", value: 2 }, lockOffset: { mode: "absolute", value: 0.1 } };

test("BUY: favorable move below trigger does not activate breakeven", () => {
  const result = evaluateBreakeven(rule, "BUY", 100, 101, undefined, undefined);
  assert.equal(result.triggered, false);
});

test("BUY: favorable move at trigger activates breakeven, proposing entry + lockOffset", () => {
  const result = evaluateBreakeven(rule, "BUY", 100, 102, undefined, undefined);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 100.1);
});

test("SELL: favorable move at trigger activates breakeven, proposing entry - lockOffset", () => {
  const result = evaluateBreakeven(rule, "SELL", 100, 98, undefined, undefined);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 99.9);
});

test("breakeven never proposes a stop worse than the current stop (BUY)", () => {
  // Proposed breakeven stop is 100.1, but current stop is already 101 (better) -> no action
  const result = evaluateBreakeven(rule, "BUY", 100, 105, undefined, 101);
  assert.equal(result.triggered, false);
});

test("breakeven proposes a stop when it strictly improves on the current stop (BUY)", () => {
  const result = evaluateBreakeven(rule, "BUY", 100, 102, undefined, 99);
  assert.equal(result.triggered, true);
  assert.equal(result.newStopPrice, 100.1);
});

test("breakeven with no existing stop is always an improvement once triggered", () => {
  const result = evaluateBreakeven(rule, "BUY", 100, 103, undefined, undefined);
  assert.equal(result.triggered, true);
});

test("an atr-multiple trigger without a supplied ATR value is a deterministic BREAKEVEN_CONSTRAINT violation, not a throw", () => {
  const atrRule: BreakevenRule = { trigger: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 }, lockOffset: { mode: "absolute", value: 0 } };
  const result = evaluateBreakeven(atrRule, "BUY", 100, 105, undefined, undefined);
  assert.equal(result.triggered, false);
  assert.equal(result.violation!.code, "BREAKEVEN_CONSTRAINT");
  assert.equal(result.violation!.reason, "MISSING_REQUIRED_VALUE");
});

test("an atr-multiple trigger WITH a supplied ATR value resolves correctly", () => {
  const atrRule: BreakevenRule = { trigger: { mode: "atr-multiple", atrMultiple: 2, atrPeriod: 14 }, lockOffset: { mode: "absolute", value: 0.1 } };
  // atrValue=1 -> trigger distance = 2*1=2; favorable move 3 >= 2 -> triggers
  const result = evaluateBreakeven(atrRule, "BUY", 100, 103, 1, undefined);
  assert.equal(result.triggered, true);
});

test("an invalid currentPrice produces a deterministic violation rather than a wrong number", () => {
  const result = evaluateBreakeven(rule, "BUY", 100, Number.NaN, undefined, undefined);
  assert.equal(result.triggered, false);
  assert.equal(result.violation!.code, "BREAKEVEN_CONSTRAINT");
});

test("repeated evaluation of the same input is deterministic", () => {
  const run = () => evaluateBreakeven(rule, "BUY", 100, 103, undefined, undefined);
  assert.deepEqual(run(), run());
});
