import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProposedSize, validateMaxPositionSize } from "../src/runtime/risk/size.js";

test("a positive integer quantity is valid", () => {
  assert.equal(validateProposedSize(1).passed, true);
});

test("a positive fractional quantity is valid (fractional sizes are allowed)", () => {
  assert.equal(validateProposedSize(0.5).passed, true);
});

test("zero quantity is rejected", () => {
  const result = validateProposedSize(0);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "INVALID_SIZE");
});

test("negative quantity is rejected", () => {
  const result = validateProposedSize(-1);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "INVALID_SIZE");
});

test("NaN quantity is rejected with a distinct reason from zero/negative", () => {
  const result = validateProposedSize(Number.NaN);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.reason, "INVALID_NUMERIC_VALUE");
});

test("Infinity quantity is rejected", () => {
  const result = validateProposedSize(Number.POSITIVE_INFINITY);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.reason, "INVALID_NUMERIC_VALUE");
});

test("no maxPositionSize configured: any positive size passes", () => {
  const result = validateMaxPositionSize({ sizing: { method: "fixed-lot", lots: 1 } }, 1_000_000);
  assert.equal(result.passed, true);
});

test("maxPositionSize configured: a size at the limit passes (not exceeding)", () => {
  const result = validateMaxPositionSize({ sizing: { method: "fixed-lot", lots: 1 }, maxPositionSize: 5 }, 5);
  assert.equal(result.passed, true);
});

test("maxPositionSize configured: a size above the limit is rejected", () => {
  const result = validateMaxPositionSize({ sizing: { method: "fixed-lot", lots: 1 }, maxPositionSize: 5 }, 5.01);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "MAX_POSITION");
  assert.equal(result.violation!.reason, "EXCEEDS_MAXIMUM");
});
