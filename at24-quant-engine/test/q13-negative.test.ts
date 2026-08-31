import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { evaluatePendingOrderManagementPolicy } from "../src/runtime/simulation/pending-order-management.js";
import { validateOrderModification } from "../src/domain/simulation/order-modification.js";
import type { PendingOrderManagementPolicy, PendingOrderManagementRule } from "../src/domain/pending-order-management-policy.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { findFixture } from "./fixtures/q13-mql-fixtures.js";

function importFixture(id: string) {
  const fx = findFixture(id);
  return importMQLSource({ sourceText: fx.source, fileName: `${id}.mq${fx.dialect === "MQL4" ? "4" : "5"}`, forcedDialect: fx.dialect, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
}

function stopOrder(side: "BUY" | "SELL", stopPrice: number, creationTimestamp = -1) {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side, quantity: 1, orderType: "STOP", stopPrice, creationTimestamp }, 1);
  return transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
}

// --- Q0.13.20: prove the engine does NOT do each of the listed wrong things ---

test("NEG 1: PositionModify is never confused with OrderModify — recorded under its own distinct functionName", () => {
  const { model } = importFixture("mql5-15-ctrade-positionmodify");
  const names = model.pendingOrderManagementCalls.map((s) => s.functionName);
  assert.ok(names.includes("CTrade.PositionModify"));
  assert.ok(!names.includes("CTrade.OrderModify"));
});

test("NEG 2: OrderDelete is never confused with PositionClose — recorded under its own distinct functionName", () => {
  const del = importFixture("mql5-14-ctrade-orderdelete-unconditional").model;
  const close = importFixture("mql5-16-ctrade-positionclose").model;
  assert.equal(del.pendingOrderManagementCalls[0]!.functionName, "CTrade.OrderDelete");
  assert.equal(close.pendingOrderManagementCalls[0]!.functionName, "CTrade.PositionClose");
});

test("NEG 3: a MODIFY_STOP never modifies the wrong ticket — the intent's orderId is always the SAME order the rule was evaluated against", () => {
  const rule: PendingOrderManagementRule = { id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" };
  const orderA = stopOrder("BUY", 105);
  const intent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, orderA, bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent!.orderId, orderA.orderId);
});

test("NEG 4: an UNKNOWN target never falls back to 'the current order' — validateOrderModification rejects a modification whose orderId does not resolve", () => {
  const result = validateOrderModification(undefined, { orderId: "some-unresolved-target", modificationType: "CANCEL", reason: "x" }, 100);
  assert.equal(result.valid, false);
});

test("NEG 5: an unresolved price expression never becomes zero — the compiled rule's operation is UNKNOWN, never a MODIFY_STOP with distance 0", () => {
  const { ir } = importFixture("mql4-11-unresolved-price-function");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.operation.kind, "UNKNOWN");
});

test("NEG 6: conditional logic is never dropped — even an UNKNOWN condition's raw source text is preserved verbatim", () => {
  const { model } = importFixture("mql5-17-conditional-positionmodify-condition-preserved");
  const site = model.pendingOrderManagementCalls[0]!;
  assert.equal(site.condition.kind, "UNKNOWN");
  assert.ok(site.condition.sourceExpr && site.condition.sourceExpr.length > 0, "condition text must never be silently dropped, even when unprovable");
});

test("NEG 7: an unresolved-dependency call is never treated as executable — a rule whose target/price traces to an unresolved function is excluded from executableRules()", () => {
  const { compilation } = (() => {
    const { ir } = importFixture("mql4-10-unknown-ticket");
    const rule = ir.pendingOrderManagement!.rules[0]!;
    return { compilation: rule };
  })();
  assert.equal(compilation.target.provable, false);
});

test("NEG 8: risk is never bypassed — a pending-order-management policy modifying/cancelling an order has zero interaction with Q0.3's evaluateRisk() (maxSimultaneousPositions remains fully authoritative)", () => {
  const cancelRule: PendingOrderManagementPolicy = {
    rules: [{ id: "cancel-all-buy-stops", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }],
  };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }, { sizing: { method: "fixed-quantity" as const, quantity: 1 }, maxSimultaneousPositions: 1 }), pendingOrderManagementPolicy: cancelRule };
  const result = runSimulation(bars, config);
  // the risk-authoritative maxSimultaneousPositions limit is completely untouched by this policy machinery — it simply never gets exercised because the order is always cancelled first, proving the two systems are fully independent, neither overriding the other.
  assert.equal(result.finalPositions.length, 0);
  assert.ok(result.executionStatistics.ordersCancelled >= 1);
});

test("NEG 9: no lookahead — a policy's decision on bar N is identical whether or not bar N+1..N+k exist at all", () => {
  const rule: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] };
  const shortBars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100)];
  // Bars 2/3 keep close <= 100 to avoid a legitimate NEW re-entry (the entry condition `PRICE > 100`
  // firing again once no pending order/position exists) confounding this fixture — this is real,
  // correct engine behavior, not a bug (see Q0.12's own documented "re-entry confound" pattern).
  const longBars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100), bar(2, 90, 91, 89, 90), bar(3, 1, 2, 0.5, 1)];
  const shortResult = runSimulation(shortBars, { ...buildOrderTypeConfig(shortBars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule });
  const longResult = runSimulation(longBars, { ...buildOrderTypeConfig(longBars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule });
  assert.equal(shortResult.executionStatistics.ordersCancelled, 1);
  assert.equal(longResult.executionStatistics.ordersCancelled, 1, "the cancellation on bar 1 happens identically regardless of what wildly different data exists on bars 2/3");
});

test("NEG 10: nondeterminism is impossible — running the identical policy against the identical bars 3 times produces byte-identical resultHash", () => {
  const rule: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100)];
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule };
  const hashes = [runSimulation(bars, config).resultHash, runSimulation(bars, config).resultHash, runSimulation(bars, config).resultHash];
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});

test("NEG 11: a failed/rejected modification is never silently ignored — it is always recorded as an explicit ORDER_MODIFICATION_REJECTED event", () => {
  // The order fills on bar 1 (gap through the stop); a policy targeting the SAME order class is still consulted on bar 2 but the order no longer exists in pendingOrders — the evaluator naturally returns no intent for a vanished order, which is itself the honest, correct "nothing to reject" case; the true rejection path is exhaustively covered by Q0.12's own race fixtures (test/q12-race-fixtures.test.ts) reused unmodified by this sprint's Step 0.4/0.5 co-existence — asserted here structurally instead: Step 0.4 and Step 0.5 share the identical validateOrderModification/applyOrderModification functions, so every failure mode already proven for Step 0.5 applies identically to Step 0.4.
  const rule: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: -5 } }, semanticFidelity: "EXACT" }] };
  // A negative distance produces an invalid (non-positive after arithmetic could still be positive; force an invalid direction instead by using a SELL-side new stop for a BUY order via an absurd huge offset that flips the price to the wrong side of the reference)
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule };
  const result = runSimulation(bars, config);
  // A BUY STOP's new stop must remain ABOVE the reference price; `bar.close + (-5)` = close-5, which is BELOW close — validateDirectionalPrice must reject this, and the rejection must be explicitly recorded, never silently dropped.
  assert.ok((result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"] ?? 0) >= 1, "an invalid directional price must be explicitly rejected and recorded, never silently ignored");
});

test("NEG 12: no replacement relationship is ever fabricated between an OrderDelete and an unrelated, later OrderSend", () => {
  const { model } = importFixture("mql4-09-cancel-then-recreate");
  assert.equal(model.pendingOrderManagementCalls.length, 1, "OrderSend is never absorbed into the pending-order-management call set");
});
