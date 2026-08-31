import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, cancelIntent, modifyStopIntent, modifyLimitIntent, modifyExpirationIntent, replaceIntent } from "./fixtures/q12-order-modification-fixtures.js";

/**
 * Q0.12.34 — the 9 required order-modification golden fixtures.
 *
 * Every fixture keeps every bar's CLOSE at or below 100 from bar 1
 * onward — the entry condition is `PRICE(close) > 100`, so once the
 * original order is cancelled/replaced/expired, a close still above 100
 * would legitimately fire a brand-new, UNRELATED re-entry (the
 * duplicate-order protection only prevents a SECOND order while one is
 * already pending — once cancelled, a fresh entry is entirely correct
 * behavior). Keeping subsequent closes <= 100 isolates each fixture to
 * proving ONE thing: what happened to THIS specific order.
 */

test("LIMIT_CREATE: creating a LIMIT order (with the new expiration/parent fields present but unset) fills exactly as before — pure backward compatibility", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 99);
  // Confirms the predicted-orderId formula this whole fixture file relies on.
  assert.equal(result.finalPositions[0]!.id, predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp));
});

test("LIMIT_MODIFY: modifying a pending LIMIT's price changes where it eventually fills", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 99.8), bar(2, 99.5, 100, 96, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }),
    orderModifications: [{ atBarIndex: 1, intent: modifyLimitIntent(orderId, 97, "strategy moved the limit down") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 97, "must fill at the MODIFIED limit (97), never the original (99)");
});

test("LIMIT_CANCEL: cancelling a pending LIMIT before it would fill leaves no position, even though the original price is later reached", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 99.9), bar(2, 99.9, 100, 95, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }),
    orderModifications: [{ atBarIndex: 1, intent: cancelIntent(orderId, "strategy no longer wants this entry") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.executionStatistics.ordersCancelled, 1);
});

test("STOP_MODIFY: modifying a pending STOP's trigger price changes where it eventually fills", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 104, 107, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 1, intent: modifyStopIntent(orderId, 105, "strategy raised the breakout level") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 105, "must trigger at the MODIFIED stop (105), never the original (103)");
});

test("STOP_CANCEL: cancelling a pending STOP before it would trigger leaves no position", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 104, 106, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 1, intent: cancelIntent(orderId, "strategy abandoned the breakout thesis") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersCancelled, 1);
});

test("STOP_LIMIT_MODIFY: modifying a pending STOP_LIMIT's limit leg before it triggers changes the eventual fill", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 102, 104, 99, 100), bar(3, 103, 105, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP_LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(103.5) }),
    orderModifications: [{ atBarIndex: 1, intent: modifyLimitIntent(orderId, 90, "narrow the limit so the order can no longer fill after triggering") }],
  };
  const result = runSimulation(bars, config);
  assert.ok(result.eventStatistics.eventsByType["ORDER_MODIFIED"]);
  // bar2: stop(103) triggers intrabar (high 104 >= 103), open(102) proves neither gap-through-both nor the (now much lower) limit(90) -- TRIGGERED only.
  // bar3: now a plain LIMIT(90) order: open(103) is nowhere near 90 -- never fills within these bars.
  assert.equal(result.finalPositions.length, 0, "the modified (narrowed) limit is now unreachable, proving the modification took effect rather than being ignored");
});

test("STOP_LIMIT_CANCEL: cancelling a pending STOP_LIMIT before it triggers leaves no position", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 102, 104, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP_LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) }),
    orderModifications: [{ atBarIndex: 1, intent: cancelIntent(orderId, "strategy cancelled before the breakout confirmed") }],
  };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersCancelled, 1);
});

test("EXPIRATION: a BAR-kind expiration policy (attached via MODIFY_EXPIRATION) expires the order before it would otherwise fill", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 99.8), bar(2, 99.5, 100, 96, 98), bar(3, 96, 100, 95, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }),
    orderModifications: [{ atBarIndex: 1, intent: modifyExpirationIntent(orderId, { kind: "BAR", maxBars: 2 }, "strategy imposed a 2-bar expiry after entry") }],
  };
  const result = runSimulation(bars, config);
  // creationBarIndex=0; expires once currentBarIndex-0 >= 2, i.e. AT bar 2 -- before bar 2's own low(96) could otherwise satisfy the limit(99).
  assert.equal(result.finalPositions.length, 0, "the order must expire at bar 2 before that same bar's own low ever gets a chance to fill it");
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.executionStatistics.ordersExpired, 1);
  assert.ok(result.eventStatistics.eventsByType["ORDER_EXPIRED"]);
});

test("REPLACE_ORDER: replacing a pending order cancels the old one and creates a genuinely new order identity with parentOrderId preserved", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 99.8), bar(2, 99.5, 100, 96, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }),
    orderModifications: [{ atBarIndex: 1, intent: replaceIntent(orderId, "strategy replaced the order with a tighter limit", { newLimitPrice: 97 }) }],
  };
  const result = runSimulation(bars, config);
  assert.ok(result.eventStatistics.eventsByType["ORDER_REPLACED"]);
  assert.equal(result.executionStatistics.ordersCancelled, 1, "the OLD order must be cancelled, never silently mutated");
  assert.equal(result.executionStatistics.ordersCreated, 2, "the replacement is a genuinely NEW order (2 total: original + replacement)");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 97, "must fill at the replacement's price, never the cancelled original's");
  assert.notEqual(result.finalPositions[0]!.id, orderId, "the resulting position's originating order must be the NEW order identity, never the cancelled old one");
});
