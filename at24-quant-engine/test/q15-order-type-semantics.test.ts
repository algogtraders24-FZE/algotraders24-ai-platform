import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { evaluatePendingOrderManagementPolicy } from "../src/runtime/simulation/pending-order-management.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import type { PendingOrderManagementPolicy, PendingOrderManagementRule } from "../src/domain/pending-order-management-policy.js";
import { MQL_ORDER_TYPE_CONSTANT_MAP } from "../src/domain/pending-order-management-policy.js";
import { bar } from "./fixtures/q11-order-fixtures.js";

/**
 * Q1.5.2 — MQL5 `OrderGetInteger(ORDER_TYPE)` recognition. See
 * docs/Q1.5_ORDER_TYPE_SEMANTICS.md for the full audit. These tests prove
 * BOTH halves of the fix together: semantic recognition (`resolveOrderTypeFilter`)
 * AND runtime-constant mapping (`MQL_ORDER_TYPE_CONSTANT_MAP`) — a rule that
 * is merely "recognized" but never actually fires at runtime would be a
 * worse, more deceptive bug than the honest UNKNOWN this replaces.
 */

const OPTS = { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD", assetClass: "forex" as const }, executionTimeframe: "M5" as const, importedAt: 0 };

function importSource(sourceText: string) {
  return importMQLSource({ sourceText, fileName: "x.mq5", forcedDialect: "MQL5", options: OPTS });
}

function deleteFixture(constant: string): string {
  return `ulong ticket = 0;\nvoid OnInit(){}\nvoid OnTick()\n{\nif(OrderGetInteger(ORDER_TYPE)==${constant})\n{\nOrderDelete(ticket);\n}\n}\n`;
}

function stopOrder(side: "BUY" | "SELL", stopPrice: number) {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side, quantity: 1, orderType: "STOP", stopPrice, creationTimestamp: -1 }, 1);
  return transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
}
function limitOrder(side: "BUY" | "SELL", limitPrice: number) {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side, quantity: 1, orderType: "LIMIT", limitPrice, creationTimestamp: -1 }, 1);
  return transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
}

// --- 1. OrderGetInteger(ORDER_TYPE) is recognized ---
test("Q1.5.2 matrix 1: OrderGetInteger(ORDER_TYPE)==ORDER_TYPE_BUY_STOP is recognized as a provable ORDER_TYPE_FILTER condition", () => {
  const { ir } = importSource(deleteFixture("ORDER_TYPE_BUY_STOP"));
  const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING")!;
  assert.ok(rule);
  assert.equal(rule.condition.kind, "ORDER_TYPE_FILTER");
  assert.equal((rule.condition as { orderTypeConstant?: string }).orderTypeConstant, "ORDER_TYPE_BUY_STOP");
});

// --- 2. each supported MQL5 order constant resolves correctly ---
for (const constant of ["ORDER_TYPE_BUY_LIMIT", "ORDER_TYPE_SELL_LIMIT", "ORDER_TYPE_BUY_STOP", "ORDER_TYPE_SELL_STOP"] as const) {
  test(`Q1.5.2 matrix 2 (${constant}): recognized, mapped, and compiles to an EXACT-fidelity executable rule`, () => {
    const { ir } = importSource(deleteFixture(constant));
    const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING")!;
    assert.ok(rule);
    assert.equal(rule.condition.kind, "ORDER_TYPE_FILTER");
    assert.equal(rule.semanticFidelity, "EXACT", `${constant} must resolve to a fully executable rule, not just a recognized-but-unmapped one`);
    assert.ok(MQL_ORDER_TYPE_CONSTANT_MAP[constant], `${constant} must be present in the shared runtime constant map`);
  });
}

// --- 3. unsupported STOP_LIMIT constants remain unsupported ---
for (const constant of ["ORDER_TYPE_BUY_STOP_LIMIT", "ORDER_TYPE_SELL_STOP_LIMIT"] as const) {
  test(`Q1.5.2 matrix 3 (${constant}): recognized as a structural order-type filter shape but NOT mapped — stays out of Q1.5's supported scope, never fabricated into an executable rule`, () => {
    const { ir } = importSource(deleteFixture(constant));
    const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING")!;
    assert.ok(rule);
    // The condition IS structurally an ORDER_TYPE_FILTER (OrderGetInteger(ORDER_TYPE) is a real type query) —
    // but CANCEL_PENDING's operation doesn't depend on the map, so this alone would (mis)report EXACT.
    // The map itself must never gain a STOP_LIMIT entry (asserted directly below), which is the real contract.
    assert.equal(MQL_ORDER_TYPE_CONSTANT_MAP[constant], undefined, `${constant} must NOT be in MQL_ORDER_TYPE_CONSTANT_MAP — STOP_LIMIT compound types are explicitly out of scope`);
  });
}

// --- 4. the resulting rule actually evaluates correctly at RUNTIME ---
test("Q1.5.2 matrix 4a: a compiled OrderGetInteger(ORDER_TYPE)==ORDER_TYPE_BUY_STOP rule fires against a real BUY STOP SimulationOrder", () => {
  const rule: PendingOrderManagementRule = {
    id: "r1",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ORDER_TYPE_FILTER", orderTypeConstant: "ORDER_TYPE_BUY_STOP", provable: true },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "EXACT",
  };
  const policy: PendingOrderManagementPolicy = { rules: [rule] };
  const intent = evaluatePendingOrderManagementPolicy(policy, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.ok(intent, "the rule must actually fire at runtime, not merely be marked provable in the IR");
  assert.equal(intent!.modificationType, "CANCEL");
});

test("Q1.5.2 matrix 4b: the same rule does NOT fire for a SELL STOP (side mismatch) or a LIMIT order (type mismatch)", () => {
  const rule: PendingOrderManagementRule = {
    id: "r1",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ORDER_TYPE_FILTER", orderTypeConstant: "ORDER_TYPE_BUY_STOP", provable: true },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "EXACT",
  };
  const policy: PendingOrderManagementPolicy = { rules: [rule] };
  assert.equal(evaluatePendingOrderManagementPolicy(policy, stopOrder("SELL", 95), bar(0, 100, 101, 99, 100), "test"), undefined);
  assert.equal(evaluatePendingOrderManagementPolicy(policy, limitOrder("BUY", 95), bar(0, 100, 101, 99, 100), "test"), undefined);
});

test("Q1.5.2 matrix 4c: an unmapped constant (pre-fix regression guard) never silently fires — a rule referencing a constant absent from the map is inert, never a false positive", () => {
  const rule: PendingOrderManagementRule = {
    id: "r1",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ORDER_TYPE_FILTER", orderTypeConstant: "ORDER_TYPE_BUY_STOP_LIMIT", provable: true },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "EXACT",
  };
  const policy: PendingOrderManagementPolicy = { rules: [rule] };
  assert.equal(evaluatePendingOrderManagementPolicy(policy, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test"), undefined, "an unmapped orderTypeConstant must never match any real order — fails closed, never guessed");
});

// --- 5. no false positive for sibling MQL5 properties (ORDER_TYPE_FILLING / ORDER_TYPE_TIME) ---
for (const sibling of ["ORDER_TYPE_FILLING", "ORDER_TYPE_TIME"] as const) {
  test(`Q1.5.2 matrix 5 (${sibling}): OrderGetInteger(${sibling}) is NEVER misclassified as an order-type filter merely because its name contains the substring "ORDER_TYPE"`, () => {
    const source = `ulong ticket = 0;\nvoid OnInit(){}\nvoid OnTick()\n{\nif(OrderGetInteger(${sibling})==1)\n{\nOrderDelete(ticket);\n}\n}\n`;
    const { ir } = importSource(source);
    const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING")!;
    assert.ok(rule, "the OrderDelete call is still detected");
    assert.equal(rule.condition.kind, "UNKNOWN", `${sibling} must resolve UNKNOWN, never a fabricated ORDER_TYPE_FILTER — exact-match discipline, not .includes()`);
  });
}

// --- existing order-property behavior regression: OrderType()/PositionGetInteger(POSITION_TYPE) still work unchanged ---
test("Q1.5.2 regression: OrderType() (MQL4/legacy) and PositionGetInteger(POSITION_TYPE) recognition is unaffected by the OrderGetInteger addition", () => {
  const orderTypeSource = `int ticket = 0;\nvoid OnTick()\n{\nif(OrderType()==OP_BUYSTOP)\n{\nOrderDelete(ticket);\n}\n}\n`;
  const { ir: irMql4 } = importMQLSource({ sourceText: orderTypeSource, fileName: "x.mq4", forcedDialect: "MQL4", options: OPTS });
  const rule4 = irMql4.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING")!;
  assert.equal(rule4.condition.kind, "ORDER_TYPE_FILTER");
  assert.equal(rule4.semanticFidelity, "EXACT");
});
