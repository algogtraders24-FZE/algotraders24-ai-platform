import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMaxSimultaneousPositions } from "../src/runtime/risk/position-limits.js";
import type { RiskSpecification } from "../src/domain/risk-specification.js";

const spec = (max: number): RiskSpecification => ({ sizing: { method: "fixed-lot", lots: 1 }, maxSimultaneousPositions: max });

test("no maxSimultaneousPositions configured: always passes regardless of count", () => {
  const result = evaluateMaxSimultaneousPositions({ sizing: { method: "fixed-lot", lots: 1 } }, 1000);
  assert.equal(result.passed, true);
});

test("zero open positions, limit 3: passes", () => {
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 0).passed, true);
});

test("below limit (2 open, limit 3): passes", () => {
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 2).passed, true);
});

test("exactly at limit (3 open, limit 3): REJECTED", () => {
  const result = evaluateMaxSimultaneousPositions(spec(3), 3);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "MAX_SIMULTANEOUS_POSITIONS");
  assert.equal(result.violation!.reason, "AT_OR_BEYOND_LIMIT");
});

test("above limit (4 open, limit 3): REJECTED", () => {
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 4).passed, false);
});

test("closing an existing position (count drops from limit to below) allows the check to pass again", () => {
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 3).passed, false);
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 2).passed, true);
});

test("modifying an existing position does not change the count used by this check (caller responsibility — this check is entry-count-only)", () => {
  // Modification doesn't add a new position; the caller simply must not
  // include modification actions in openPositionCount. This test documents
  // that evaluateMaxSimultaneousPositions has no concept of "modify" at all
  // — it is a pure function of a count.
  assert.equal(evaluateMaxSimultaneousPositions(spec(3), 2).passed, true);
});
