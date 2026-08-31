import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMaxHoldingPeriod } from "../src/runtime/risk/holding-period.js";
import type { RiskSpecification } from "../src/domain/risk-specification.js";

const HOUR = 3_600_000;
const ENTRY = Date.parse("2026-06-01T00:00:00Z");

const barsSpec: RiskSpecification = { sizing: { method: "fixed-lot", lots: 1 }, maxHoldingPeriod: { maxBars: 10 } };
const durationSpec: RiskSpecification = { sizing: { method: "fixed-lot", lots: 1 }, maxHoldingPeriod: { maxDurationMs: 10 * HOUR } };

test("no maxHoldingPeriod configured: always passes", () => {
  const result = evaluateMaxHoldingPeriod({ sizing: { method: "fixed-lot", lots: 1 } }, { entryTimestamp: ENTRY, barsHeld: 999 }, ENTRY + 999 * HOUR);
  assert.equal(result.passed, true);
});

test("maxBars: before the limit passes", () => {
  assert.equal(evaluateMaxHoldingPeriod(barsSpec, { entryTimestamp: ENTRY, barsHeld: 9 }, ENTRY + 9 * HOUR).passed, true);
});

test("maxBars: exactly at the limit is REJECTED", () => {
  const result = evaluateMaxHoldingPeriod(barsSpec, { entryTimestamp: ENTRY, barsHeld: 10 }, ENTRY + 10 * HOUR);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "MAX_HOLDING_PERIOD");
});

test("maxBars: after the limit is REJECTED", () => {
  assert.equal(evaluateMaxHoldingPeriod(barsSpec, { entryTimestamp: ENTRY, barsHeld: 15 }, ENTRY + 15 * HOUR).passed, false);
});

test("maxDurationMs: before the limit passes", () => {
  assert.equal(evaluateMaxHoldingPeriod(durationSpec, { entryTimestamp: ENTRY }, ENTRY + 9 * HOUR).passed, true);
});

test("maxDurationMs: exactly at the limit is REJECTED", () => {
  assert.equal(evaluateMaxHoldingPeriod(durationSpec, { entryTimestamp: ENTRY }, ENTRY + 10 * HOUR).passed, false);
});

test("maxDurationMs: after the limit is REJECTED", () => {
  assert.equal(evaluateMaxHoldingPeriod(durationSpec, { entryTimestamp: ENTRY }, ENTRY + 11 * HOUR).passed, false);
});

test("both maxBars and maxDurationMs configured: EITHER triggering is sufficient (OR logic)", () => {
  const bothSpec: RiskSpecification = { sizing: { method: "fixed-lot", lots: 1 }, maxHoldingPeriod: { maxBars: 100, maxDurationMs: 5 * HOUR } };
  // barsHeld well under 100, but duration exceeds 5h -> still rejected
  const result = evaluateMaxHoldingPeriod(bothSpec, { entryTimestamp: ENTRY, barsHeld: 2 }, ENTRY + 6 * HOUR);
  assert.equal(result.passed, false);
});

test("missing/invalid entryTimestamp (NaN) is rejected with INVALID_NUMERIC_VALUE, not silently treated as 0", () => {
  const result = evaluateMaxHoldingPeriod(barsSpec, { entryTimestamp: Number.NaN, barsHeld: 1 }, ENTRY);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.reason, "INVALID_NUMERIC_VALUE");
});

test("invalid asOf (NaN) is rejected", () => {
  const result = evaluateMaxHoldingPeriod(barsSpec, { entryTimestamp: ENTRY, barsHeld: 1 }, Number.NaN);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.reason, "INVALID_NUMERIC_VALUE");
});
