import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePartialClose } from "../src/runtime/risk/partial-close.js";
import type { PartialCloseRule } from "../src/domain/risk-specification.js";

const rule: PartialCloseRule = { trigger: { mode: "absolute", value: 3 }, closePercent: 50 };

test("before trigger: no action", () => {
  assert.equal(evaluatePartialClose(rule, "BUY", 100, 101, undefined, false).triggered, false);
});

test("at trigger: triggers with the configured closePercent", () => {
  const result = evaluatePartialClose(rule, "BUY", 100, 103, undefined, false);
  assert.equal(result.triggered, true);
  assert.equal(result.closePercent, 50);
});

test("SELL direction mirrors BUY", () => {
  const result = evaluatePartialClose(rule, "SELL", 100, 97, undefined, false);
  assert.equal(result.triggered, true);
});

test("INVARIANT: alreadyTriggered=true never re-triggers, regardless of how favorable the price is", () => {
  const result = evaluatePartialClose(rule, "BUY", 100, 999, undefined, true);
  assert.equal(result.triggered, false);
});

test("closePercent returned is always the spec's configured value, never recomputed or capped ad hoc", () => {
  const rule80: PartialCloseRule = { trigger: { mode: "absolute", value: 1 }, closePercent: 80 };
  const result = evaluatePartialClose(rule80, "BUY", 100, 105, undefined, false);
  assert.equal(result.closePercent, 80);
  assert.ok(result.closePercent! <= 100);
});

test("an invalid currentPrice produces a deterministic violation", () => {
  const result = evaluatePartialClose(rule, "BUY", 100, Number.NaN, undefined, false);
  assert.equal(result.triggered, false);
  assert.equal(result.violation!.code, "PARTIAL_CLOSE_CONSTRAINT");
});

test("an atr-multiple trigger without a supplied ATR value is a deterministic violation, not a throw", () => {
  const atrRule: PartialCloseRule = { trigger: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 }, closePercent: 50 };
  const result = evaluatePartialClose(atrRule, "BUY", 100, 102, undefined, false);
  assert.equal(result.violation!.code, "PARTIAL_CLOSE_CONSTRAINT");
  assert.equal(result.violation!.reason, "MISSING_REQUIRED_VALUE");
});

test("repeated evaluation of the same input is deterministic", () => {
  const run = () => evaluatePartialClose(rule, "BUY", 100, 103, undefined, false);
  assert.deepEqual(run(), run());
});
