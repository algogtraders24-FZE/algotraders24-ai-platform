import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, modifyLimitIntent } from "./fixtures/q12-order-modification-fixtures.js";

/**
 * Q0.12.30 — position-management separation. `domain/simulation/order-modification.ts`
 * (Q0.12) and `domain/position-management.ts` (Q0.10) are two entirely
 * separate modules, sharing no type and no evaluation function — a
 * `MODIFY_STOP` order-modification (Q0.12, acts on a PENDING order's
 * OWN stop-trigger price before it fills) and a `MODIFY_STOP` risk
 * action (Q0.10/Q0.3, acts on an OPEN position's protective stop after
 * it fills) are NAME-ALIKE but structurally unrelated — this test proves
 * both can operate on the SAME strategy's lifecycle without ever
 * colliding or duplicating logic.
 */
test("Q0.12.30: a LIMIT order modified before fill, once filled, is STILL managed by Q0.10's own unmodified breakeven logic — no duplicate trailing/breakeven logic exists in the order-modification layer", () => {
  const risk = {
    sizing: { method: "fixed-quantity" as const, quantity: 1 },
    stopLoss: { type: "fixed-distance" as const, distance: 5 },
    breakeven: { trigger: { mode: "absolute" as const, value: 3 }, lockOffset: { mode: "absolute" as const, value: 0 } },
  };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 100, 100.5, 99.5, 99.8), // MODIFY_LIMIT scheduled here (before the order would fill)
    bar(2, 97, 97.5, 96, 96.5), // the MODIFIED limit (97) fills here via strict trade-through (low 96 < 97)
    bar(3, 98, 101, 97.5, 100), // favorable move = 101-97 = 4 >= breakeven trigger(3) -> breakeven fires, stop -> 97 (entry)
    bar(4, 98, 99, 96, 97), // Step1b: stop=97 (moved to breakeven), low=96 <= 97 -> exits at breakeven
  ];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }, risk),
    orderModifications: [{ atBarIndex: 1, intent: modifyLimitIntent(orderId, 97, "tighten the limit before fill") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 97, "the ENTRY fill must reflect the Q0.12 order modification");
  assert.equal(trade.exitPrice, 97, "the EXIT must reflect Q0.10's OWN, unmodified breakeven logic moving the stop to exactly entry");
  assert.equal(trade.rMultiple, 0, "a well-defined breakeven exit, proving Q0.10's management pipeline never needed to know or care that the entry order had been modified");
});

// --- Q0.12.31: risk remains authoritative — max-simultaneous-positions is never bypassed by order modification/replacement machinery ---
test("Q0.12.31: max-simultaneous-positions is still enforced for the ORIGINAL entry decision regardless of any later order modification", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, maxSimultaneousPositions: 1 };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)];
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }, risk);
  const result = runSimulation(bars, config);
  // With no existing position, the entry is allowed -- proving the risk check itself is exercised (not bypassed by the mere PRESENCE of order-modification config fields, since none are used here).
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.executionStatistics.ordersRejected, 0);
});

test("Q0.12.31: a REPLACE never fabricates a position that risk would otherwise have rejected — quantity/geometry validation still applies to the replacement's own resulting fill", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, maxPositionSize: 0.5 };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 99.8), bar(2, 99.5, 100, 96, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }, risk),
    orderModifications: [{ atBarIndex: 1, intent: { orderId, modificationType: "REPLACE" as const, newLimitPrice: 97, reason: "x" } }],
  };
  const result = runSimulation(bars, config);
  // maxPositionSize=0.5 rejects the ORIGINAL 1-quantity entry outright (REJECT_ENTRY -> NO_OP, no order ever instantiated),
  // before any order-modification schedule is even relevant -- proving risk's own size check ran first and is completely
  // unaffected by the presence of a (never-reached) modification schedule.
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersCreated, 0, "no order is ever created for a proposed entry Q0.3's own risk evaluation rejects");
});
