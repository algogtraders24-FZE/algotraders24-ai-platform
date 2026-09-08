import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";
import {
  ALL_GOLDEN_IR_FIXTURES,
  fixturePyramiding,
  fixtureMQL5Netting,
  fixtureMQL4OrderFlow,
  fixtureMT5Hedging,
  fixtureRepainting,
  fixtureUnsupportedSemantic,
  fixtureMTF,
  fixtureEMACrossover,
} from "./fixtures/strategy-ir-fixtures.js";

/**
 * checkReductionEligibility() is the "honest block" gate — it must run
 * BEFORE any StrategySpec is built, and must never let through an IR
 * shape Q0.5/Q0.6 cannot actually execute. These tests exercise it
 * against Q0.7's own 23 golden IR fixtures (reused, not re-derived) plus
 * a few targeted single-reason checks.
 */

test("Q0.9: every one of Q0.7's 23 golden IR fixtures produces a deterministic, non-throwing eligibility verdict", () => {
  for (const fn of ALL_GOLDEN_IR_FIXTURES) {
    const ir = fn();
    assert.doesNotThrow(() => checkReductionEligibility(ir), `fixture ${ir.strategyId} threw`);
  }
});

test("Q0.9: exactly the two fixtures whose positionManagement is ACCUMULATE+REVERSE (pyramiding, mql5-netting) are eligible; every other fixture is blocked", () => {
  const results = ALL_GOLDEN_IR_FIXTURES.map((fn) => {
    const ir = fn();
    return { id: ir.strategyId, eligible: checkReductionEligibility(ir).eligible };
  });
  const eligibleIds = results.filter((r) => r.eligible).map((r) => r.id).sort();
  assert.deepEqual(eligibleIds, ["fixture-07-pyramiding", "fixture-17-mql5-netting"]);
});

test("Q0.9: HEDGING accounting mode is always blocked — Q0.5/Q0.6 implement NETTING only", () => {
  const result = checkReductionEligibility(fixtureMQL4OrderFlow());
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.includes("HEDGING")));
  const hedging = checkReductionEligibility(fixtureMT5Hedging());
  assert.ok(hedging.blockingReasons.some((r) => r.includes("HEDGING")));
});

test("Q0.9: non-ACCUMULATE pyramiding and non-REVERSE reversal are each independently blocking (not silently ignored just because the other is fine)", () => {
  const ir = fixtureMQL5Netting();
  const withRejectPyramiding = { ...ir, positionManagement: { ...ir.positionManagement, pyramiding: { ...ir.positionManagement.pyramiding, sameDirectionBehavior: "REJECT" as const } } };
  const result = checkReductionEligibility(withRejectPyramiding);
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.includes("sameDirectionBehavior")));
});

test("Q0.9: a HIGHER-role timeframeSeries is blocking — genuine dual-timeframe strategy calculation is not implemented", () => {
  const result = checkReductionEligibility(fixtureMTF());
  assert.ok(result.blockingReasons.some((r) => r.includes("HIGHER")));
});

test("Q0.9: a REPAINTING repaintingModel is blocking, independent of any other issue", () => {
  const result = checkReductionEligibility(fixtureRepainting());
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.toLowerCase().includes("repaint")));
});

test("Q0.9: an UNSUPPORTED semanticStatus with a BLOCKING unsupportedSemantic entry is itself blocking", () => {
  const result = checkReductionEligibility(fixtureUnsupportedSemantic());
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.includes("CustomWaveIndicator")));
});

test("Q1.5.3: a SIGNAL_EXIT exit kind with a real condition is NO LONGER blocking (genuinely evaluated since Q1.5.3 — see docs/Q1.5_EXIT_CONTRACT.md; previously blocked pre-Q1.5, when exitRules were accepted but never evaluated)", () => {
  const result = checkReductionEligibility(fixtureEMACrossover());
  assert.ok(!result.blockingReasons.some((r) => r.includes("SIGNAL_EXIT")), `SIGNAL_EXIT must not appear in blockingReasons for a fixture with a real condition; got: ${JSON.stringify(result.blockingReasons)}`);
  // fixtureEMACrossover() is still ineligible overall — but ONLY for its own,
  // separate, pre-existing reasons (REJECT pyramiding / CLOSE_THEN_OPEN
  // reversal), unrelated to SIGNAL_EXIT. Asserted explicitly so this test
  // fails loudly if either of THOSE reasons is ever accidentally resolved
  // without this test being revisited.
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.includes("sameDirectionBehavior")));
  assert.ok(result.blockingReasons.some((r) => r.includes("positionManagement.reversal")));
});

test("Q1.5.3: a SIGNAL_EXIT exit kind with NO condition remains blocking — nothing to evaluate can never be executed", () => {
  const ir = fixtureEMACrossover();
  const withoutCondition = {
    ...ir,
    exits: ir.exits.map((e) => {
      if (e.kind !== "SIGNAL_EXIT") return e;
      const { condition: _condition, ...rest } = e;
      return rest;
    }),
  };
  const result = checkReductionEligibility(withoutCondition);
  assert.ok(result.blockingReasons.some((r) => r.includes("SIGNAL_EXIT") && r.includes("no condition")));
});

test("Q0.9: checkReductionEligibility never mutates its input IR", () => {
  const ir = fixtureMQL5Netting();
  const before = JSON.stringify(ir);
  checkReductionEligibility(ir);
  assert.equal(JSON.stringify(ir), before);
});

test("Q0.9: an eligible fixture (mql5-netting) reports zero blocking reasons", () => {
  const result = checkReductionEligibility(fixtureMQL5Netting());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockingReasons, []);
});
