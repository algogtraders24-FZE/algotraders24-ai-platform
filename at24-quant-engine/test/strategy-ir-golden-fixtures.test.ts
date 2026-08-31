import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { ALL_GOLDEN_IR_FIXTURES } from "./fixtures/strategy-ir-fixtures.js";

test("Q0.7.56: all 23 hand-built golden fixtures build without throwing and are structurally valid", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    const result = validateStrategyIR(ir);
    assert.equal(result.valid, true, `${ir.strategyId}: expected structurally valid, errors: ${result.errors.join("; ")}`);
  }
});

test("every golden fixture has a unique strategyId", () => {
  const ids = ALL_GOLDEN_IR_FIXTURES.map((build) => build().strategyId);
  assert.equal(new Set(ids).size, ids.length);
});

test("Q0.7.22: the repainting fixture is structurally valid but NOT execution-eligible", () => {
  const repainting = ALL_GOLDEN_IR_FIXTURES.find((b) => b().strategyId === "fixture-23-repainting")!;
  const result = validateStrategyIR(repainting());
  assert.equal(result.executionEligible, false);
  assert.ok(result.blockingReasons.length > 0);
});

test("Q0.7.31: the unsupported-semantic fixture is structurally valid but NOT execution-eligible", () => {
  const unsupported = ALL_GOLDEN_IR_FIXTURES.find((b) => b().strategyId === "fixture-22-unsupported-semantic")!;
  const result = validateStrategyIR(unsupported());
  assert.equal(result.valid, true);
  assert.equal(result.executionEligible, false);
});

test("every OTHER golden fixture (non-repainting, non-unsupported) IS execution-eligible", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    if (ir.strategyId === "fixture-23-repainting" || ir.strategyId === "fixture-22-unsupported-semantic") continue;
    const result = validateStrategyIR(ir);
    assert.equal(result.executionEligible, true, `${ir.strategyId}: expected execution-eligible, blocking: ${result.blockingReasons.join("; ")}`);
  }
});

test("every golden fixture produces a 64-character hex resultHash via computeCanonicalIRHash", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const hash = computeCanonicalIRHash(build());
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test("Q0.7.14: MQL4 order-flow and MT5-hedging fixtures both declare HEDGING; MQL5-netting declares NETTING", () => {
  const mql4 = ALL_GOLDEN_IR_FIXTURES.find((b) => b().strategyId === "fixture-16-mql4-order-flow")!();
  const mt5Hedge = ALL_GOLDEN_IR_FIXTURES.find((b) => b().strategyId === "fixture-18-mt5-hedging")!();
  const mql5Net = ALL_GOLDEN_IR_FIXTURES.find((b) => b().strategyId === "fixture-17-mql5-netting")!();
  assert.equal(mql4.positionManagement.accountingMode, "HEDGING");
  assert.equal(mt5Hedge.positionManagement.accountingMode, "HEDGING");
  assert.equal(mql5Net.positionManagement.accountingMode, "NETTING");
});
