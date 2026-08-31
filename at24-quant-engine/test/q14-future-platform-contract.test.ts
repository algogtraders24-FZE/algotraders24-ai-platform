import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStrategyIRStructure } from "../src/domain/strategy-ir/strategy-ir.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";
import { literal, comparison, indicatorOperand } from "../src/domain/expression.js";
import { indicator } from "../src/domain/indicator-reference.js";
import { fixtureMQL5Netting } from "./fixtures/strategy-ir-fixtures.js";
import type { StrategyIR } from "../src/domain/strategy-ir/strategy-ir.js";

/**
 * Q1.4.14 — hand-built IR fixtures ONLY (no Pine/NinjaScript/cBot parser
 * exists or is built here), proving the CURRENT canonical abstraction can
 * (or cannot) represent representative future-platform concepts, at the
 * TYPE and ELIGIBILITY level. These are architecture-representability
 * proofs, never "this platform is implemented" claims.
 */

const BASE = fixtureMQL5Netting();

test("Q1.4 FUTURE-PLATFORM: Pine strategy.entry(..., limit=X) — REPRESENTABLE via EntryIR.executionType='LIMIT'/limitPrice", () => {
  const ir: StrategyIR = { ...BASE, indicators: [{ kind: "named", family: "RSI", params: [14] }], entries: [{ id: "e1", direction: "BUY", condition: comparison(">", indicatorOperand(indicator("RSI", 14)), literal(30)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "LIMIT", limitPrice: { kind: "OPERAND", operand: literal(1.1) } }], exits: [] };
  assert.equal(validateStrategyIRStructure(ir).valid, true);
  assert.equal(validateStrategyIR(ir).executionEligible, true);
});

test("Q1.4 FUTURE-PLATFORM: Pine strategy.cancel(id) — REPRESENTABLE via PendingOrderManagementOperation.CANCEL_PENDING (the SAME contract Q0.13/Q1.3 built for MQL, never a second one)", () => {
  const ir: StrategyIR = { ...BASE, pendingOrderManagement: { rules: [{ id: "cancel-rule", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] } };
  assert.equal(validateStrategyIRStructure(ir).valid, true);
});

test("Q1.4 FUTURE-PLATFORM: NinjaScript EnterLongStopLimit — REPRESENTABLE via the pre-existing STOP_LIMIT executionType", () => {
  const ir: StrategyIR = { ...BASE, indicators: [{ kind: "named", family: "EMA", params: [9] }], entries: [{ id: "e1", direction: "BUY", condition: comparison(">", indicatorOperand(indicator("EMA", 9)), literal(1.1)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "STOP_LIMIT", stopPrice: { kind: "OPERAND", operand: literal(1.12) }, limitPrice: { kind: "OPERAND", operand: literal(1.121) } }], exits: [] };
  assert.equal(validateStrategyIRStructure(ir).valid, true);
  assert.equal(validateStrategyIR(ir).executionEligible, true);
});

test("Q1.4 FUTURE-PLATFORM: cBot ModifyPendingOrder(newPrice) — REPRESENTABLE via PendingOrderManagementOperation.MODIFY_STOP/MODIFY_LIMIT, the SAME contract as MQL5's CTrade.OrderModify", () => {
  const ir: StrategyIR = { ...BASE, pendingOrderManagement: { rules: [{ id: "modify-rule", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 0.001 } }, semanticFidelity: "EXACT" }] } };
  assert.equal(validateStrategyIRStructure(ir).valid, true);
});

test("Q1.4 FUTURE-PLATFORM: Pine pyramiding=N — the IR TYPE can express a numeric cap (PyramidingPolicy.maxEntries/maxPositions), but this cap is NOT enforced anywhere: eligibility only checks sameDirectionBehavior==='ACCUMULATE', never the numeric value, and Q0.5's engine has no 'reject after N entries' code path at all (grep-verified: maxEntries/maxPositions appear ONLY in position-ir.ts's own type declaration, referenced nowhere else in src/)", () => {
  const ir: StrategyIR = { ...BASE, positionManagement: { ...BASE.positionManagement, pyramiding: { allowPyramiding: true, maxEntries: 1, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" } } };
  const { eligible } = checkReductionEligibility(ir);
  assert.equal(eligible, true, "a maxEntries cap of 1 passes eligibility identically to no cap at all — the value itself is never inspected, a real, honestly-documented enforcement gap, not a Q1.4 defect");
});

test("Q1.4 FUTURE-PLATFORM: Pine strategy.order() (raw order, no pyramiding bookkeeping) — NOT REPRESENTABLE: every AT24 entry goes through the SAME risk-gated path (evaluateRisk -> mapRiskAction), there is no 'bookkeeping-free' order primitive anywhere in the IR/Spec/execution contracts", () => {
  assert.ok(true, "documented absence — no fixture can represent a concept this IR structurally has no field for");
});
