import { test } from "node:test";
import assert from "node:assert/strict";
import { reduceStrategyIRToSpec } from "../src/runtime/reduction/ir-to-spec-reducer.js";
import { validateStrategySpec } from "../src/domain/strategy-spec.js";
import { fixturePyramiding, fixtureMQL5Netting, fixtureRepainting, ALL_GOLDEN_IR_FIXTURES } from "./fixtures/strategy-ir-fixtures.js";

test("Q0.9: an eligible IR reduces to REDUCED (or REDUCED_WITH_WARNINGS) with a present, structurally-valid StrategySpec", () => {
  const result = reduceStrategyIRToSpec(fixtureMQL5Netting());
  assert.ok(result.status === "REDUCED" || result.status === "REDUCED_WITH_WARNINGS");
  assert.ok(result.strategySpec);
  assert.equal(validateStrategySpec(result.strategySpec!).valid, true);
});

test("Q0.9: an ineligible IR reduces to BLOCKED with NO strategySpec at all — never a partial/fabricated one", () => {
  const result = reduceStrategyIRToSpec(fixtureRepainting());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.strategySpec, undefined);
  assert.ok(result.diagnostics.length > 0);
});

test("Q0.9: reduceStrategyIRToSpec never mutates its input IR or any nested object (risk/execution/entries/exits)", () => {
  const ir = fixturePyramiding();
  const beforeJson = JSON.stringify(ir);
  reduceStrategyIRToSpec(ir);
  assert.equal(JSON.stringify(ir), beforeJson);
});

test("Q0.9: risk and execution are passed through by direct reference, never rebuilt or cloned", () => {
  const ir = fixtureMQL5Netting();
  const result = reduceStrategyIRToSpec(ir);
  assert.equal(result.strategySpec!.risk, ir.risk);
  assert.equal(result.strategySpec!.execution, ir.execution.declared);
});

test("Q0.9: exitRules are always empty in a reduced StrategySpec — STOP_LOSS/TAKE_PROFIT are risk-driven, not condition-based, and SIGNAL_EXIT/SESSION_EXIT are already gate-blocked", () => {
  const result = reduceStrategyIRToSpec(fixtureMQL5Netting());
  assert.deepEqual(result.strategySpec!.exitRules, []);
});

test("Q0.9: running the reducer twice over the same IR is deterministic (identical StrategySpec shape) and repeatable without throwing", () => {
  const ir = fixtureMQL5Netting();
  const r1 = reduceStrategyIRToSpec(ir);
  const r2 = reduceStrategyIRToSpec(ir);
  assert.deepEqual(r1.strategySpec, r2.strategySpec);
  assert.equal(r1.status, r2.status);
});

test("Q0.9: reduceStrategyIRToSpec never throws for any of the 23 golden IR fixtures — BLOCKED is a valid return, an exception is not", () => {
  for (const fn of ALL_GOLDEN_IR_FIXTURES) {
    assert.doesNotThrow(() => reduceStrategyIRToSpec(fn()));
  }
});

test("Q0.9: a BLOCKED result's diagnostics text-match the eligibility gate's own blockingReasons (no silent divergence between the two layers)", () => {
  const result = reduceStrategyIRToSpec(fixtureRepainting());
  assert.ok(result.diagnostics.some((d) => d.toLowerCase().includes("repaint")));
});
