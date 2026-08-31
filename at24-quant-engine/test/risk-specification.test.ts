import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRiskSpecification, validatePositionSizingMethod } from "../src/domain/risk-specification.js";

test("fixed-quantity sizing accepts a positive quantity", () => {
  const result = validatePositionSizingMethod({ method: "fixed-quantity", quantity: 1 });
  assert.equal(result.valid, true);
});

test("fixed-quantity sizing rejects zero or negative quantity", () => {
  assert.equal(validatePositionSizingMethod({ method: "fixed-quantity", quantity: 0 }).valid, false);
  assert.equal(validatePositionSizingMethod({ method: "fixed-quantity", quantity: -1 }).valid, false);
});

test("percent-equity-risk accepts a percent in (0, 100]", () => {
  assert.equal(validatePositionSizingMethod({ method: "percent-equity-risk", percent: 1 }).valid, true);
  assert.equal(validatePositionSizingMethod({ method: "percent-equity-risk", percent: 100 }).valid, true);
});

test("percent-equity-risk rejects out-of-range percent", () => {
  assert.equal(validatePositionSizingMethod({ method: "percent-equity-risk", percent: 0 }).valid, false);
  assert.equal(validatePositionSizingMethod({ method: "percent-equity-risk", percent: 101 }).valid, false);
  assert.equal(validatePositionSizingMethod({ method: "percent-equity-risk", percent: -5 }).valid, false);
});

test("atr-based sizing requires positive atrMultiple and atrPeriod", () => {
  assert.equal(validatePositionSizingMethod({ method: "atr-based", atrMultiple: 1.5, atrPeriod: 14 }).valid, true);
  assert.equal(validatePositionSizingMethod({ method: "atr-based", atrMultiple: 0, atrPeriod: 14 }).valid, false);
  assert.equal(validatePositionSizingMethod({ method: "atr-based", atrMultiple: 1.5, atrPeriod: 0 }).valid, false);
});

test("a fully valid RiskSpecification passes", () => {
  const result = validateRiskSpecification({
    sizing: { method: "percent-equity-risk", percent: 1 },
    stopLoss: { type: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 },
    takeProfit: { type: "risk-multiple", rMultiple: 2 },
    maxPositionSize: 5,
    maxExposure: 10,
  });
  assert.equal(result.valid, true);
});

test("invalid maxPositionSize and maxExposure are both reported", () => {
  const result = validateRiskSpecification({
    sizing: { method: "fixed-lot", lots: 1 },
    maxPositionSize: -1,
    maxExposure: 0,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test("invalid stopLoss and takeProfit distances are rejected", () => {
  const result = validateRiskSpecification({
    sizing: { method: "fixed-lot", lots: 1 },
    stopLoss: { type: "fixed-distance", distance: 0 },
    takeProfit: { type: "risk-multiple", rMultiple: -1 },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("stopLoss.distance")));
  assert.ok(result.errors.some((e) => e.includes("takeProfit.rMultiple")));
});
