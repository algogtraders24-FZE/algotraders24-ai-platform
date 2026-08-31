import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { evaluatePendingOrderManagementPolicy } from "../src/runtime/simulation/pending-order-management.js";
import type { PendingOrderManagementPolicy, PendingOrderManagementRule } from "../src/domain/pending-order-management-policy.js";
import { bar } from "./fixtures/q11-order-fixtures.js";

function stopOrder(side: "BUY" | "SELL", stopPrice: number, creationTimestamp = -1) {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side, quantity: 1, orderType: "STOP", stopPrice, creationTimestamp }, 1);
  return transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
}
function limitOrder(side: "BUY" | "SELL", limitPrice: number, creationTimestamp = -1) {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side, quantity: 1, orderType: "LIMIT", limitPrice, creationTimestamp }, 1);
  return transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
}

const cancelBuyStopRule: PendingOrderManagementRule = {
  id: "r1",
  target: { kind: "SYMBOL", provable: true },
  condition: { kind: "ORDER_TYPE_FILTER", orderTypeConstant: "OP_BUYSTOP", provable: true },
  operation: { kind: "CANCEL_PENDING" },
  semanticFidelity: "EXACT",
};

test("Q0.13: CANCEL_PENDING fires when the order-type filter matches the order's own type and side", () => {
  const policy: PendingOrderManagementPolicy = { rules: [cancelBuyStopRule] };
  const order = stopOrder("BUY", 105);
  const intent = evaluatePendingOrderManagementPolicy(policy, order, bar(0, 100, 101, 99, 100), "test");
  assert.ok(intent);
  assert.equal(intent!.modificationType, "CANCEL");
});

test("Q0.13: CANCEL_PENDING does NOT fire for a SELL STOP when the filter names OP_BUYSTOP", () => {
  const policy: PendingOrderManagementPolicy = { rules: [cancelBuyStopRule] };
  const order = stopOrder("SELL", 95);
  const intent = evaluatePendingOrderManagementPolicy(policy, order, bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent, undefined);
});

test("Q0.13: CANCEL_PENDING does NOT fire for a LIMIT order even with matching side, when the filter names a STOP type", () => {
  const policy: PendingOrderManagementPolicy = { rules: [cancelBuyStopRule] };
  const order = limitOrder("BUY", 95);
  const intent = evaluatePendingOrderManagementPolicy(policy, order, bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent, undefined);
});

test("Q0.13: MODIFY_STOP computes the new stop price relative to the CURRENT bar's close, direction-aware for BUY and SELL", () => {
  const rule: PendingOrderManagementRule = {
    id: "r2",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ALWAYS", provable: true },
    operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 0.5 } },
    semanticFidelity: "EXACT",
  };
  const buyIntent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(buyIntent!.modificationType, "MODIFY_STOP");
  assert.equal(buyIntent!.newStopPrice, 100.5);

  const sellIntent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("SELL", 95), bar(0, 100, 101, 99, 100), "test");
  assert.equal(sellIntent!.newStopPrice, 99.5);
});

test("Q0.13: MODIFY_LIMIT computes the new limit price relative to the current bar's close, direction-aware", () => {
  const rule: PendingOrderManagementRule = {
    id: "r3",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ALWAYS", provable: true },
    operation: { kind: "MODIFY_LIMIT", newDistanceFromClose: { mode: "absolute", value: 1 } },
    semanticFidelity: "EXACT",
  };
  const buyIntent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, limitOrder("BUY", 95), bar(0, 100, 101, 99, 100), "test");
  assert.equal(buyIntent!.newLimitPrice, 99);
  const sellIntent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, limitOrder("SELL", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(sellIntent!.newLimitPrice, 101);
});

test("Q0.13: FAVORABLE_DISTANCE only fires once price has moved far enough from the order's own reference price", () => {
  const rule: PendingOrderManagementRule = {
    id: "r4",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "FAVORABLE_DISTANCE", distance: { mode: "absolute", value: 3 }, provable: true },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "EXACT",
  };
  const order = stopOrder("BUY", 105); // reference (stopPrice) = 105
  const notYet = evaluatePendingOrderManagementPolicy({ rules: [rule] }, order, bar(0, 103, 104, 102, 103), "test"); // moved 2, needs 3
  assert.equal(notYet, undefined);
  const now = evaluatePendingOrderManagementPolicy({ rules: [rule] }, order, bar(1, 101, 102, 100, 101), "test"); // moved 4
  assert.ok(now);
});

test("Q0.13: a condition kind UNKNOWN never fires, regardless of the bar", () => {
  const rule: PendingOrderManagementRule = {
    id: "r5",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "UNKNOWN", provable: false },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "UNKNOWN",
  };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("BUY", 105), bar(0, 1, 1000, 1, 1000), "test");
  assert.equal(intent, undefined);
});

test("Q0.13: a rule with target.provable === false is defensively skipped even though its condition/operation would otherwise fire", () => {
  const rule: PendingOrderManagementRule = {
    id: "r6",
    target: { kind: "UNKNOWN", provable: false },
    condition: { kind: "ALWAYS", provable: true },
    operation: { kind: "CANCEL_PENDING" },
    semanticFidelity: "UNKNOWN",
  };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent, undefined, "never executes an unprovable rule, belt-and-braces even if executableRules() was somehow bypassed by the caller");
});

test("Q0.13: an operation kind UNKNOWN is defensively skipped", () => {
  const rule: PendingOrderManagementRule = {
    id: "r7",
    target: { kind: "SYMBOL", provable: true },
    condition: { kind: "ALWAYS", provable: true },
    operation: { kind: "UNKNOWN" },
    semanticFidelity: "UNKNOWN",
  };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [rule] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent, undefined);
});

test("Q0.13: rules are evaluated in declared order — the first matching rule wins", () => {
  const noMatch: PendingOrderManagementRule = { id: "no-match", target: { kind: "SYMBOL", sideFilter: "SELL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" };
  const match: PendingOrderManagementRule = { id: "match", target: { kind: "SYMBOL", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" };
  const intent = evaluatePendingOrderManagementPolicy({ rules: [noMatch, match] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent!.modificationType, "MODIFY_STOP");
});

test("Q0.13: an empty rule set never produces an intent", () => {
  const intent = evaluatePendingOrderManagementPolicy({ rules: [] }, stopOrder("BUY", 105), bar(0, 100, 101, 99, 100), "test");
  assert.equal(intent, undefined);
});
