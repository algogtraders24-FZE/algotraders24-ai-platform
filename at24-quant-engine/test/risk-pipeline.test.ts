import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { ALL_RISK_FIXTURES } from "./fixtures/risk-fixtures.js";

for (const fixture of ALL_RISK_FIXTURES) {
  test(`golden fixture ${fixture.name}: ${fixture.reason}`, () => {
    const result = evaluateRisk(fixture.input);
    assert.equal(result.outcome, fixture.expectedOutcome, `outcome mismatch for ${fixture.name}`);
    assert.equal(result.action.type, fixture.expectedActionType, `action type mismatch for ${fixture.name}`);
    const codes = result.violations.map((v) => v.code).sort();
    assert.deepEqual(codes, [...fixture.expectedViolationCodes].sort(), `violation codes mismatch for ${fixture.name}`);
  });
}

test("no proposedEntry and no existingPosition: ALLOWED / NO_ACTION (nothing to evaluate)", () => {
  const result = evaluateRisk({
    asOf: 0,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 } },
    instrument: { symbol: "X" },
    direction: "BUY",
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });
  assert.equal(result.outcome, "ALLOWED");
  assert.equal(result.action.type, "NO_ACTION");
});

test("evaluatedAt always echoes input.asOf, never a wall-clock value", () => {
  const asOf = 123_456_789;
  const result = evaluateRisk({
    asOf,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 } },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: 1, entryPrice: 100 },
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });
  assert.equal(result.evaluatedAt, asOf);
});

test("entry-stage input violations are collected together, not just the first one found", () => {
  const result = evaluateRisk({
    asOf: 0,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxPositionSize: 1 },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: 5, entryPrice: 100, stopLoss: 105 }, // both oversized AND invalid stop
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });
  assert.equal(result.outcome, "REJECTED");
  const codes = result.violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["INVALID_STOP", "MAX_POSITION"]);
});

test("session/position-limit/daily-loss stages are NOT reached when input validation already failed (short-circuit)", () => {
  const result = evaluateRisk({
    asOf: 0,
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      sessionHours: { timezone: "Not/A_Zone", windows: [{ startHour: 0, startMinute: 0, endHour: 1, endMinute: 0 }] },
    },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: -1, entryPrice: 100 }, // invalid size
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });
  // Only the size violation should appear, even though the session config
  // is also bogus — session is never reached because size failed first.
  assert.deepEqual(result.violations.map((v) => v.code), ["INVALID_SIZE"]);
});
