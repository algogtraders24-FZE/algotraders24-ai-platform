import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, cancelIntent, modifyStopIntent } from "./fixtures/q12-order-modification-fixtures.js";

/**
 * Q0.12.23/24/35 — the 5 required race fixtures. Every race resolves
 * deterministically via ONE explicit rule: a scheduled modification for
 * bar N is applied in "Step 0.5", strictly BEFORE that bar's own Step 1
 * fill/expiration resolution — never derived from wall-clock timing,
 * never ambiguous. See docs/Q0.12_RACE_SEMANTICS.md.
 */

const STOP_BARS = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 104, 106, 99, 100)];

test("CANCEL_BEFORE_TRIGGER: a cancel scheduled for the SAME bar the order would otherwise trigger wins — no fill", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 2, intent: cancelIntent(orderId, "cancelled on the exact bar the breakout would have triggered") }],
  };
  const result = runSimulation(STOP_BARS, config);
  assert.equal(result.finalPositions.length, 0, "cancel (Step 0.5) is applied before fill resolution (Step 1) on the SAME bar — the order never gets a chance to trigger");
  assert.equal(result.executionStatistics.ordersCancelled, 1);
  assert.equal(result.executionStatistics.ordersFilled, 0);
});

test("TRIGGER_BEFORE_CANCEL: the order fills on an earlier bar than a later-scheduled cancel — the cancel is rejected, never silently applied to a filled order", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  // No modification scheduled for bar 2 (where it naturally triggers) -- instead, a cancel is scheduled for bar 3, AFTER the fill already happened.
  const barsWithExtra = [...STOP_BARS, bar(3, 100, 100.5, 99, 100)];
  const config = {
    ...buildOrderTypeConfig(barsWithExtra, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 3, intent: cancelIntent(orderId, "attempted cancel after the fact") }],
  };
  const result = runSimulation(barsWithExtra, config);
  assert.equal(result.finalPositions.length, 1, "the order already filled at bar 2 -- a bar-3 cancel attempt targets a FILLED (terminal) order and is rejected, never undoing the fill");
  assert.equal(result.finalPositions[0]!.entryPrice, 104);
  assert.equal(result.executionStatistics.ordersCancelled, 0, "the rejected cancel attempt must not be counted as a real cancellation");
  assert.ok(result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"]);
});

test("MODIFY_BEFORE_TRIGGER: a modification scheduled for the SAME bar the order would otherwise trigger applies first, changing the outcome", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }),
    // bar 2's high (106) would trigger the ORIGINAL stop (103); modifying it to 105 on the SAME bar still leaves it reachable, but at the NEW level.
    orderModifications: [{ atBarIndex: 2, intent: modifyStopIntent(orderId, 105, "raised on the exact bar it would have triggered") }],
  };
  const result = runSimulation(STOP_BARS, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 105, "the modification (Step 0.5) applies before fill resolution (Step 1) on the SAME bar -- the fill uses the NEW stop, never the original");
});

test("TRIGGER_BEFORE_MODIFY: the order fills on an earlier bar than a later-scheduled modification — the modification is rejected, never silently applied to a filled order", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const barsWithExtra = [...STOP_BARS, bar(3, 100, 100.5, 99, 100)];
  const config = {
    ...buildOrderTypeConfig(barsWithExtra, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 3, intent: modifyStopIntent(orderId, 110, "attempted modification after the fact") }],
  };
  const result = runSimulation(barsWithExtra, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 104, "the order already filled at bar 2 -- a bar-3 modify attempt targets a FILLED (terminal) order and is rejected, the fill price never retroactively changes");
  assert.ok(result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"]);
});

test("SAME_TIMESTAMP_SEQUENCE_ORDER: without any scheduled modification, the SAME bar naturally fills the order — proving the race fixtures above genuinely depend on Step 0.5 running first, not on some other incidental cause", () => {
  const result = runSimulation(STOP_BARS, buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 104, "the control case: absent any modification, bar 2 fills at the open since it gaps past the stop level");
});
