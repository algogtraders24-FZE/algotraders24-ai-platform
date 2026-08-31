import { test } from "node:test";
import assert from "node:assert/strict";
import { compareParity } from "../src/runtime/strategy-ir/parity-engine.js";
import { fixtureMQL5Netting, fixtureMT5Hedging, fixtureSimpleSMA } from "./fixtures/strategy-ir-fixtures.js";

test("Q0.7.49: comparing an IR against an exact clone of itself reports identical: true and zero differences", () => {
  const ir = fixtureSimpleSMA();
  const report = compareParity(ir, { ...ir });
  assert.equal(report.identical, true);
  assert.equal(report.differences.length, 0);
});

test("Q0.7.49/50: comparing MQL5-netting vs MT5-hedging fixtures reports an EXECUTION_DIFFERENCE on positionManagement — the account-mode divergence is explicitly surfaced, never hidden", () => {
  const report = compareParity(fixtureMQL5Netting(), fixtureMT5Hedging());
  assert.equal(report.identical, false);
  const positionDiff = report.differences.find((d) => d.feature === "positionManagement");
  assert.ok(positionDiff, "positionManagement difference must be reported");
  assert.equal(positionDiff.category, "EXECUTION_DIFFERENCE");
});

test("Q0.7.50: every reported difference has a valid ParityDifferenceCategory and both leftValue/rightValue populated", () => {
  const report = compareParity(fixtureMQL5Netting(), fixtureMT5Hedging());
  const validCategories = new Set(["EXACT_PARITY", "SEMANTIC_PARITY", "EXECUTION_DIFFERENCE", "DATA_DIFFERENCE", "PLATFORM_DIFFERENCE", "UNSUPPORTED", "UNKNOWN"]);
  for (const diff of report.differences) {
    assert.ok(validCategories.has(diff.category));
    assert.ok(diff.leftValue.length > 0);
    assert.ok(diff.rightValue.length > 0);
  }
});

test("compareParity is symmetric in WHICH differences it finds (same feature set), even though left/right values swap", () => {
  const forward = compareParity(fixtureMQL5Netting(), fixtureMT5Hedging());
  const backward = compareParity(fixtureMT5Hedging(), fixtureMQL5Netting());
  const forwardFeatures = new Set(forward.differences.map((d) => d.feature));
  const backwardFeatures = new Set(backward.differences.map((d) => d.feature));
  assert.deepEqual(forwardFeatures, backwardFeatures);
});
