import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntryGeometry, computeRiskDistance, validateRiskDistance } from "../src/runtime/risk/geometry.js";

test("BUY: SL below entry, TP above entry -> no violations", () => {
  assert.deepEqual(validateEntryGeometry("BUY", 100, 98, 104), []);
});

test("SELL: SL above entry, TP below entry -> no violations", () => {
  assert.deepEqual(validateEntryGeometry("SELL", 100, 102, 96), []);
});

test("BUY: SL at or above entry is invalid", () => {
  const violations = validateEntryGeometry("BUY", 100, 100, undefined);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.code, "INVALID_STOP");
});

test("BUY: SL above entry is invalid", () => {
  const violations = validateEntryGeometry("BUY", 100, 105, undefined);
  assert.equal(violations[0]!.code, "INVALID_STOP");
});

test("SELL: SL at or below entry is invalid", () => {
  const violations = validateEntryGeometry("SELL", 100, 100, undefined);
  assert.equal(violations[0]!.code, "INVALID_STOP");
});

test("BUY: TP at or below entry is invalid", () => {
  const violations = validateEntryGeometry("BUY", 100, undefined, 100);
  assert.equal(violations[0]!.code, "INVALID_TARGET");
});

test("SELL: TP at or above entry is invalid", () => {
  const violations = validateEntryGeometry("SELL", 100, undefined, 100);
  assert.equal(violations[0]!.code, "INVALID_TARGET");
});

test("missing SL is not itself an error (SL is optional)", () => {
  assert.deepEqual(validateEntryGeometry("BUY", 100, undefined, 104), []);
});

test("missing TP is not itself an error (TP is optional)", () => {
  assert.deepEqual(validateEntryGeometry("BUY", 100, 98, undefined), []);
});

test("negative or non-finite stopLoss/takeProfit is invalid", () => {
  assert.equal(validateEntryGeometry("BUY", 100, -5, undefined)[0]!.code, "INVALID_STOP");
  assert.equal(validateEntryGeometry("BUY", 100, undefined, Number.NaN)[0]!.code, "INVALID_TARGET");
});

test("non-finite or non-positive entryPrice short-circuits with a single INVALID_RISK_DISTANCE violation", () => {
  const violations = validateEntryGeometry("BUY", -1, 98, 104);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.code, "INVALID_RISK_DISTANCE");
});

test("both an invalid stop AND an invalid target are reported together, not just the first", () => {
  const violations = validateEntryGeometry("BUY", 100, 105, 90);
  const codes = violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["INVALID_STOP", "INVALID_TARGET"]);
});

test("computeRiskDistance: BUY is entry - stop, SELL is stop - entry", () => {
  assert.equal(computeRiskDistance("BUY", 100, 98), 2);
  assert.equal(computeRiskDistance("SELL", 100, 102), 2);
});

test("validateRiskDistance passes for a positive distance", () => {
  assert.equal(validateRiskDistance("BUY", 100, 98).passed, true);
});

test("validateRiskDistance rejects a non-positive distance", () => {
  const result = validateRiskDistance("BUY", 100, 102); // SL above entry on a BUY -> negative distance
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "INVALID_RISK_DISTANCE");
});
