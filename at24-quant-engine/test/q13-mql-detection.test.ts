import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { findFixture } from "./fixtures/q13-mql-fixtures.js";

function importFixture(id: string) {
  const fx = findFixture(id);
  return importMQLSource({
    sourceText: fx.source,
    fileName: `${id}.mq${fx.dialect === "MQL4" ? "4" : "5"}`,
    forcedDialect: fx.dialect,
    options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 },
  });
}

// --- MQL4 (fixtures 1-12) ---

test("Q0.13 mql4-01: OrderModify SL-only is detected as a pendingOrderManagementCalls site, distinct from managementPatterns/modifyCalls", () => {
  const { model } = importFixture("mql4-01-modify-sl");
  assert.equal(model.pendingOrderManagementCalls.length, 1);
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.functionName, "OrderModify");
  assert.equal(site.target.kind, "TICKET");
  assert.equal(site.condition.kind, "UNCONDITIONAL");
  // Q0.8's existing generic bucket must ALSO still record it, unchanged — additive, never a replacement.
  assert.equal(model.modifyCalls.length, 1);
});

test("Q0.13 mql4-02/03: OrderModify TP-only and SL+TP-together are both detected identically (this importer's price-arg-only lens does not distinguish SL vs TP changes — that remains Q0.10's ManagementPatternSite's job)", () => {
  const tp = importFixture("mql4-02-modify-tp").model;
  const both = importFixture("mql4-03-modify-sl-and-tp").model;
  assert.equal(tp.pendingOrderManagementCalls.length, 1);
  assert.equal(both.pendingOrderManagementCalls.length, 1);
  assert.equal(tp.pendingOrderManagementCalls[0]!.functionName, "OrderModify");
});

test("Q0.13 mql4-04: OrderModify's non-zero expiration argument is captured as newExpirationExpr", () => {
  const { model } = importFixture("mql4-04-modify-expiration");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.newExpirationExpr, "1893456000");
});

test("Q0.13 mql4-05: OrderDelete guarded by OrderType()==OP_BUYSTOP resolves to a fully-executable CANCEL_PENDING rule via the IR/policy layer", () => {
  const { model, ir } = importFixture("mql4-05-delete-pending-by-type");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.functionName, "OrderDelete");
  assert.equal(site.target.kind, "TICKET");
  assert.equal(site.condition.kind, "ORDER_TYPE_FILTER");
  assert.equal(site.condition.orderTypeConstant, "OP_BUYSTOP");
  assert.ok(ir.pendingOrderManagement, "IR must carry a compiled pendingOrderManagement block");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "CANCEL_PENDING");
  assert.equal(rule.semanticFidelity, "EXACT");
});

test("Q0.13 mql4-06: a provable FAVORABLE_DISTANCE condition preserves the condition, but the operation stays UNKNOWN because the target order's own type (LIMIT vs STOP) cannot be resolved without a guess", () => {
  const { model, ir } = importFixture("mql4-06-conditional-modify-unresolvable-type");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.condition.kind, "FAVORABLE_DISTANCE");
  assert.equal(site.condition.favorableTriggerDistance?.kind, "fixed-distance");
  assert.equal(site.condition.favorableTriggerDistance?.distance, 0.003);
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "UNKNOWN", "never guessed into MODIFY_STOP or MODIFY_LIMIT without a provable order-type filter");
  assert.equal(rule.semanticFidelity, "UNKNOWN");
});

test("Q0.13 mql4-07: OrderDelete guarded by OP_SELLSTOP mirrors fixture 5 for the SELL side", () => {
  const { ir } = importFixture("mql4-07-delete-pending-sellstop");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "CANCEL_PENDING");
  assert.equal(rule.target.sideFilter, "SELL");
  assert.equal(rule.target.orderTypeFilter, "STOP");
});

test("Q0.13 mql4-08: order-type filter + resolvable price distance compiles into a fully executable MODIFY_STOP", () => {
  const { ir } = importFixture("mql4-08-price-modification-executable");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "MODIFY_STOP");
  if (rule.operation.kind === "MODIFY_STOP") {
    assert.deepEqual(rule.operation.newDistanceFromClose, { mode: "absolute", value: 0.0015 });
  }
  assert.equal(rule.semanticFidelity, "EXACT");
  assert.equal(rule.target.orderTypeFilter, "STOP");
  assert.equal(rule.target.sideFilter, "BUY");
});

test("Q0.13 mql4-09: OrderDelete followed by an unrelated OrderSend never fabricates a REPLACE relationship", () => {
  const { model, ir } = importFixture("mql4-09-cancel-then-recreate");
  assert.equal(model.pendingOrderManagementCalls.length, 1, "only the OrderDelete call is recorded here — OrderSend is a separate, unrelated entry-order call site");
  assert.equal(model.pendingOrderManagementCalls[0]!.functionName, "OrderDelete");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "CANCEL_PENDING");
  assert.ok(!("parentOrderId" in rule) && !("replacesOrderId" in rule), "no replace/parent linkage field exists anywhere on a compiled rule — never fabricated");
});

test("Q0.13 mql4-10: an unresolved-function ticket argument resolves the target to UNKNOWN, never guessed as 'the current order'", () => {
  const { model, ir } = importFixture("mql4-10-unknown-ticket");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.target.kind, "UNKNOWN");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.target.provable, false);
  assert.equal(rule.semanticFidelity, "UNKNOWN");
});

test("Q0.13 mql4-11: a good order-type-filter condition cannot rescue an unresolved cross-file price function — operation stays UNKNOWN", () => {
  const { ir } = importFixture("mql4-11-unresolved-price-function");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.condition.kind, "ORDER_TYPE_FILTER");
  assert.equal(rule.operation.kind, "UNKNOWN");
});

test("Q0.13 mql4-12: a dynamic, non-literal price expression (no literal/ATR magnitude) never gets approximated into a fabricated distance", () => {
  const { ir } = importFixture("mql4-12-unsupported-dynamic-expression");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "UNKNOWN");
});

// --- MQL5 (fixtures 13-20) ---

test("Q0.13 mql5-13: CTrade.OrderModify is detected and named distinctly from bare OrderModify", () => {
  const { model } = importFixture("mql5-13-ctrade-ordermodify-unconditional");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.functionName, "CTrade.OrderModify");
  assert.equal(site.condition.kind, "UNCONDITIONAL");
});

test("Q0.13 mql5-14: an unconditional CTrade.OrderDelete is a real, fully-provable, fully-executable CANCEL_PENDING", () => {
  const { ir } = importFixture("mql5-14-ctrade-orderdelete-unconditional");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "CANCEL_PENDING");
  assert.equal(rule.condition.kind, "ALWAYS");
  assert.equal(rule.semanticFidelity, "EXACT");
});

test("Q0.13 mql5-15: CTrade.PositionModify is recorded distinctly and NEVER compiled into the pending-order policy (Q0.10's own domain)", () => {
  const { model, ir } = importFixture("mql5-15-ctrade-positionmodify");
  assert.equal(model.pendingOrderManagementCalls[0]!.functionName, "CTrade.PositionModify");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "UNKNOWN");
  assert.equal(rule.semanticFidelity, "UNKNOWN");
});

test("Q0.13 mql5-16: CTrade.PositionClose is recorded distinctly from CTrade.OrderDelete", () => {
  const { model } = importFixture("mql5-16-ctrade-positionclose");
  assert.equal(model.pendingOrderManagementCalls[0]!.functionName, "CTrade.PositionClose");
});

test("Q0.13 mql5-17: `if(newSL > currentSL) trade.PositionModify(...)` preserves the raw condition text verbatim rather than collapsing to a bare MOVE_STOP label", () => {
  const { model } = importFixture("mql5-17-conditional-positionmodify-condition-preserved");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.functionName, "CTrade.PositionModify");
  assert.equal(site.condition.kind, "UNKNOWN");
  assert.equal(site.condition.sourceExpr, "newSL > currentSL", "the condition must remain part of the semantic representation, never reduced to a bare enum");
});

test("Q0.13 mql5-18: CTrade.OrderModify guarded by a provable order-type filter compiles into a fully executable MODIFY_STOP", () => {
  const { ir } = importFixture("mql5-18-ctrade-ordermodify-executable");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "MODIFY_STOP");
  assert.equal(rule.semanticFidelity, "EXACT");
});

test("Q0.13 mql5-19: an expiration-only CTrade.OrderModify is detected (newExpirationExpr populated) but never compiled into an executable operation", () => {
  const { model, ir } = importFixture("mql5-19-ctrade-ordermodify-expiration-detected-not-compiled");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.newExpirationExpr, "1893456000");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "UNKNOWN", "a raw datetime expiration is not reducible to Q0.12's bar-count expiration policy without the execution timeframe's duration — documented Q0.14 scope, never approximated");
});

test("Q0.13 mql5-20: CTrade.OrderDelete with an unresolved-function ticket argument resolves the target to UNKNOWN", () => {
  const { model, ir } = importFixture("mql5-20-unresolved-target");
  assert.equal(model.pendingOrderManagementCalls[0]!.target.kind, "UNKNOWN");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.target.provable, false);
  assert.equal(rule.semanticFidelity, "UNKNOWN");
});
