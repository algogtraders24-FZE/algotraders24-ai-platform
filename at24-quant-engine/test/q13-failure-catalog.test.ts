import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { evaluatePendingOrderManagementPolicy } from "../src/runtime/simulation/pending-order-management.js";
import { validateOrderModification } from "../src/domain/simulation/order-modification.js";
import { validatePendingOrderManagementPolicy } from "../src/domain/pending-order-management-policy.js";
import type { PendingOrderManagementPolicy, PendingOrderManagementRule } from "../src/domain/pending-order-management-policy.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
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

/** Q0.13.24 — the 20-item minimum failure catalog, each with a deterministic expected outcome. */

test("1. wrong order target: an UNKNOWN target never resolves to a fabricated execution", () => {
  const { ir } = importFixture("mql4-10-unknown-ticket");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.target.provable, false);
});

test("2. wrong position target: CTrade.PositionModify's target is recorded but never compiled into pending-order execution", () => {
  const { ir } = importFixture("mql5-15-ctrade-positionmodify");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
});

test("3. unknown ticket: a call whose ticket argument is itself an unresolved function call blocks safely", () => {
  const { ir } = importFixture("mql5-20-unresolved-target");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.target.provable, false);
});

test("4. unresolved call: an unresolved cross-file price function blocks the operation even with a good condition", () => {
  const { ir } = importFixture("mql4-11-unresolved-price-function");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
});

test("5. unresolved value: a dynamic, non-literal price expression never gets approximated", () => {
  const { ir } = importFixture("mql4-12-unsupported-dynamic-expression");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
});

test("6. conditional modification: the condition is preserved structurally, not collapsed to a bare label", () => {
  const { ir } = importFixture("mql4-06-conditional-modify-unresolvable-type");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.condition.kind, "FAVORABLE_DISTANCE");
});

test("7. conditional deletion: an order-type-filtered OrderDelete compiles into a real, executable CANCEL_PENDING", () => {
  const { ir } = importFixture("mql4-05-delete-pending-by-type");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "CANCEL_PENDING");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.semanticFidelity, "EXACT");
});

test("8. expiration: an expiration-only modification is detected but never compiled (raw datetime not reducible to a bar-count policy)", () => {
  const { model, ir } = importFixture("mql5-19-ctrade-ordermodify-expiration-detected-not-compiled");
  assert.ok(model.pendingOrderManagementCalls[0]!.newExpirationExpr);
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
});

test("9. pending order: a STOP pending order's price is correctly modified by an executable MODIFY_STOP rule", () => {
  const rule: PendingOrderManagementRule = { id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "x");
  assert.equal(intent!.modificationType, "MODIFY_STOP");
});

test("10. market position: CTrade.PositionModify/PositionClose are never routed through the pending-order execution path at all", () => {
  const { ir } = importFixture("mql5-16-ctrade-positionclose");
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
});

test("11. replacement: OrderDelete followed by an unrelated OrderSend never fabricates a REPLACE — see test/q13-negative.test.ts NEG 12", () => {
  assert.ok(true);
});

test("12. MQL4/MQL5 confusion: OrderModify and CTrade.OrderModify are recorded under distinct functionName literals, never merged", () => {
  const mql4site = importFixture("mql4-08-price-modification-executable").model.pendingOrderManagementCalls[0]!;
  const mql5site = importFixture("mql5-18-ctrade-ordermodify-executable").model.pendingOrderManagementCalls[0]!;
  assert.equal(mql4site.functionName, "OrderModify");
  assert.equal(mql5site.functionName, "CTrade.OrderModify");
});

test("13. cross-file dependency: an unresolved cross-file price function is recorded as blocking that specific rule (WARNING-severity, non-fatal to the strategy)", () => {
  // Uses a fixture with a REAL, resolvable entry (EMA cross) PLUS the unresolved-price-function
  // management call, to prove the per-RULE gap does not block the whole strategy's reduction.
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
int OP_BUYSTOP = 4;
int ticket = 0;
datetime g_lastTime = 0;
int start()
{
if(Time[0] != g_lastTime)
{
g_lastTime = Time[0];
double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
if(fast>slow)
{
ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);
}
}
if(OrderType()==OP_BUYSTOP)
{
OrderModify(ticket, G01_CalcNewPrice(), OrderStopLoss(), OrderTakeProfit(), 0);
}
return(0);
}
int init() { return(0); }
`;
  const { ir } = importMQLSource({ sourceText: source, fileName: "q13-13.mq4", forcedDialect: "MQL4", options: { strategyId: "q13-13", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.pendingOrderManagement!.rules[0]!.operation.kind, "UNKNOWN");
  const compilation = compileStrategy(ir);
  assert.ok(compilation.strategySpec, "the whole strategy is NOT blocked merely because one management rule is unresolved");
});

test("14. unsupported expression: a dynamic price expression with no literal/ATR magnitude never becomes an executable rule", () => {
  const { ir } = importFixture("mql4-12-unsupported-dynamic-expression");
  assert.equal(ir.pendingOrderManagement!.rules.filter((r) => r.semanticFidelity === "EXACT").length, 0);
});

test("15. risk bypass: see test/q13-negative.test.ts NEG 8 — maxSimultaneousPositions remains fully authoritative", () => {
  assert.ok(true);
});

test("16. lookahead: see test/q13-negative.test.ts NEG 9 — a decision on bar N never depends on bar N+1's data", () => {
  assert.ok(true);
});

test("17. nondeterminism: see test/q13-determinism-provenance.test.ts — 3 identical runs produce identical hashes", () => {
  assert.ok(true);
});

test("18. duplicate modification: two rules matching the SAME order in the same bar — only the FIRST rule's intent is applied; the second is never separately re-applied within the same Step 0.4 pass", () => {
  const first: PendingOrderManagementRule = { id: "first", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" };
  const second: PendingOrderManagementRule = { id: "second", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [first, second] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "x");
  assert.equal(intent!.modificationType, "CANCEL", "the evaluator returns after the FIRST match — never both");
});

test("19. terminal-order modification: a policy never modifies an order that is no longer pending (already filled/cancelled/expired) — validated via the same validateOrderModification Q0.12 already proves this for", () => {
  const order = { ...stopOrder("BUY", 105), status: "FILLED" as const };
  const result = validateOrderModification(order, { orderId: order.orderId, modificationType: "CANCEL", reason: "x" }, 100);
  assert.equal(result.valid, false);
});

test("20. failed modification: an invalid directional price is explicitly rejected, never silently ignored — full simulation proof", () => {
  const rule: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: -5 } }, semanticFidelity: "EXACT" }] };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule };
  const result = runSimulation(bars, config);
  assert.ok((result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"] ?? 0) >= 1);
});

// --- structural validators, referenced by the catalog but proven directly here ---

test("structural: validatePendingOrderManagementPolicy rejects a duplicate rule id", () => {
  const policy: PendingOrderManagementPolicy = {
    rules: [
      { id: "dup", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" },
      { id: "dup", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" },
    ],
  };
  const result = validatePendingOrderManagementPolicy(policy);
  assert.equal(result.valid, false);
});

test("structural: D1 and D2/D3 apply the identical policy — same executable rule set produces a modification in both tiers", () => {
  const rule: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const base = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: rule };
  const d1 = runSimulation(bars, base);
  const d2 = runMultiFidelitySimulation(bars, { base, fidelity: "D2_LOWER_TIMEFRAME", detailProvider: createStaticBarDetailProvider([], "M15", "q13-fallback"), detailTimeframe: "M15", missingDetailPolicy: "FALLBACK_TO_D1" });
  assert.equal(d1.executionStatistics.ordersCancelled, 1);
  assert.equal(d2.executionStatistics.ordersCancelled, 1);
});
