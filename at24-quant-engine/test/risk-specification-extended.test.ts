import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRiskSpecification, validateDistanceSpec } from "../src/domain/risk-specification.js";

const baseSizing = { sizing: { method: "fixed-lot" as const, lots: 1 } };

test("a valid breakeven rule (absolute distances) passes", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    breakeven: { trigger: { mode: "absolute", value: 2 }, lockOffset: { mode: "absolute", value: 0.1 } },
  });
  assert.equal(result.valid, true);
});

test("a breakeven rule with a zero-value distance is rejected", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    breakeven: { trigger: { mode: "absolute", value: 0 }, lockOffset: { mode: "absolute", value: 0.1 } },
  });
  assert.equal(result.valid, false);
});

test("a valid trailing stop (ATR-multiple mode) passes", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    trailingStop: {
      activation: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 },
      distance: { mode: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 },
    },
  });
  assert.equal(result.valid, true);
});

test("an ATR-multiple distance with non-positive atrPeriod is rejected", () => {
  const result = validateDistanceSpec({ mode: "atr-multiple", atrMultiple: 1, atrPeriod: 0 }, "test");
  assert.equal(result.valid, false);
});

test("a valid partial close (closePercent in (0,100]) passes", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    partialClose: { trigger: { mode: "percentage", value: 1 }, closePercent: 50 },
  });
  assert.equal(result.valid, true);
});

test("partialClose.closePercent out of range is rejected", () => {
  assert.equal(
    validateRiskSpecification({ ...baseSizing, partialClose: { trigger: { mode: "percentage", value: 1 }, closePercent: 0 } }).valid,
    false,
  );
  assert.equal(
    validateRiskSpecification({ ...baseSizing, partialClose: { trigger: { mode: "percentage", value: 1 }, closePercent: 101 } }).valid,
    false,
  );
});

test("a valid session-hours window passes", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    sessionHours: { timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 30 }] },
  });
  assert.equal(result.valid, true);
});

test("an empty session-hours windows list is rejected", () => {
  const result = validateRiskSpecification({ ...baseSizing, sessionHours: { timezone: "UTC", windows: [] } });
  assert.equal(result.valid, false);
});

test("a session window where start is not before end is rejected", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    sessionHours: { timezone: "UTC", windows: [{ startHour: 16, startMinute: 0, endHour: 8, endMinute: 0 }] },
  });
  assert.equal(result.valid, false);
});

test("an out-of-range session hour/minute is rejected", () => {
  const result = validateRiskSpecification({
    ...baseSizing,
    sessionHours: { timezone: "UTC", windows: [{ startHour: 25, startMinute: 0, endHour: 26, endMinute: 61 }] },
  });
  assert.equal(result.valid, false);
});

test("maxHoldingPeriod requires at least one of maxBars/maxDurationMs", () => {
  const result = validateRiskSpecification({ ...baseSizing, maxHoldingPeriod: {} });
  assert.equal(result.valid, false);
});

test("maxHoldingPeriod with only maxBars set is valid", () => {
  const result = validateRiskSpecification({ ...baseSizing, maxHoldingPeriod: { maxBars: 50 } });
  assert.equal(result.valid, true);
});

test("maxSimultaneousPositions must be > 0", () => {
  assert.equal(validateRiskSpecification({ ...baseSizing, maxSimultaneousPositions: 0 }).valid, false);
  assert.equal(validateRiskSpecification({ ...baseSizing, maxSimultaneousPositions: 3 }).valid, true);
});

test("dailyLossLimit percent-equity mode must be in (0,100]", () => {
  assert.equal(validateRiskSpecification({ ...baseSizing, dailyLossLimit: { mode: "percent-equity", percent: 0 } }).valid, false);
  assert.equal(validateRiskSpecification({ ...baseSizing, dailyLossLimit: { mode: "percent-equity", percent: 5 } }).valid, true);
});

test("dailyLossLimit fixed-amount mode must be > 0", () => {
  assert.equal(validateRiskSpecification({ ...baseSizing, dailyLossLimit: { mode: "fixed-amount", amount: -1 } }).valid, false);
  assert.equal(validateRiskSpecification({ ...baseSizing, dailyLossLimit: { mode: "fixed-amount", amount: 500 } }).valid, true);
});

test("all Q0-original risk fields still validate exactly as before (backward compatibility)", () => {
  const result = validateRiskSpecification({
    sizing: { method: "percent-equity-risk", percent: 1 },
    stopLoss: { type: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 },
    takeProfit: { type: "risk-multiple", rMultiple: 2 },
    maxPositionSize: 5,
  });
  assert.equal(result.valid, true);
});
