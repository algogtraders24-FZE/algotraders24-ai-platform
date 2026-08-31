import { test } from "node:test";
import assert from "node:assert/strict";
import { validateExecutionSpecification } from "../src/domain/execution-specification.js";

test("all costs unset AND costsExplicitlyZero not set is REJECTED (hidden zero-cost assumption)", () => {
  const result = validateExecutionSpecification({ fillModel: "next-bar-open" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("costsExplicitlyZero")));
});

test("all costs unset but costsExplicitlyZero: true is accepted (explicit opt-in)", () => {
  const result = validateExecutionSpecification({ fillModel: "next-bar-open", costsExplicitlyZero: true });
  assert.equal(result.valid, true);
});

test("explicitly specifying spread satisfies the explicitness requirement without costsExplicitlyZero", () => {
  const result = validateExecutionSpecification({ fillModel: "next-bar-open", spread: { type: "fixed-points", value: 0.3 } });
  assert.equal(result.valid, true);
});

test("explicitly specifying commissionPerUnit alone satisfies the explicitness requirement", () => {
  const result = validateExecutionSpecification({ fillModel: "next-bar-open", commissionPerUnit: 0.01 });
  assert.equal(result.valid, true);
});

test("negative commissionPerUnit, fee, latency, spread, or slippage values are rejected", () => {
  assert.equal(
    validateExecutionSpecification({ fillModel: "next-bar-open", commissionPerUnit: -1 }).valid,
    false,
  );
  assert.equal(
    validateExecutionSpecification({ fillModel: "next-bar-open", fee: { type: "fixed-per-trade", value: -1 } }).valid,
    false,
  );
  assert.equal(
    validateExecutionSpecification({ fillModel: "next-bar-open", latency: { type: "fixed-ms", value: -1 }, costsExplicitlyZero: true }).valid,
    false,
  );
  assert.equal(
    validateExecutionSpecification({ fillModel: "next-bar-open", spread: { type: "fixed-points", value: -1 } }).valid,
    false,
  );
  assert.equal(
    validateExecutionSpecification({ fillModel: "next-bar-open", slippage: { type: "percent", value: -1 } }).valid,
    false,
  );
});

test("marginAssumption.leverage must be > 0", () => {
  const result = validateExecutionSpecification({
    fillModel: "next-bar-open",
    costsExplicitlyZero: true,
    marginAssumption: { leverage: 0 },
  });
  assert.equal(result.valid, false);
});

test("a fully explicit, realistic execution specification passes", () => {
  const result = validateExecutionSpecification({
    fillModel: "intrabar-touch",
    spread: { type: "fixed-points", value: 0.3 },
    slippage: { type: "fixed-points", value: 0.1 },
    commissionPerUnit: 0.02,
    fee: { type: "fixed-per-trade", value: 1 },
    latency: { type: "fixed-ms", value: 50 },
    priceBasis: "mid",
    marginAssumption: { leverage: 30 },
  });
  assert.equal(result.valid, true);
});
