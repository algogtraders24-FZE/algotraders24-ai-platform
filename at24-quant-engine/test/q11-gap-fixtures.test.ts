import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";

/** Q0.11.34/11 — the engine must never assume trigger price == fill price when a bar gaps through a pending level. */

test("LIMIT_GAP_THROUGH: price opens BELOW a BUY limit — fills at the favorable open, never worse than the limit", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 97, 97.5, 96, 96.5)]; // bar opens (97) below the limit(99) -- a favorable gap
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 97, "the gap is FAVORABLE for a BUY (cheaper than requested) -- fills at the open, strictly better than the limit, never at the stale limit price");
});

test("STOP_GAP_THROUGH: price opens BEYOND a BUY stop — fills at the worse open, never at the stop level itself", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 106, 107, 105, 106.5)]; // bar opens (106) beyond the stop(103) -- an unfavorable gap
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 106, "the engine must never assume trigger price == fill price -- a stop that gaps through fills at the WORSE actual open, never the stop level");
});

test("STOP_LIMIT_NO_FILL: the stop triggers, but price never returns to satisfy the limit before the run ends — the order expires with ZERO trades, yet the trigger stays visible", () => {
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 104, 101.5, 103.5), // stop(103) triggers intrabar; open(102) proves neither the both-levels gap nor the limit(90) -- TRIGGERED only
    bar(2, 104, 106, 103, 105), // price keeps rising, NEVER comes back down to the limit(90)
    bar(3, 105, 108, 104, 107),
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(90) }));
  assert.equal(result.tradeLedger.length, 0, "no trade may ever be fabricated for a limit that was never actually reached");
  assert.equal(result.finalPositions.length, 0, "no phantom position may exist for an order that never filled");
  assert.ok(result.eventStatistics.eventsByType["ORDER_TRIGGERED"], "the STOP having triggered must remain a visible, recorded fact even though the order never filled (Q0.11.7)");
  assert.equal(result.executionStatistics.ordersExpired, 1, "the still-pending TRIGGERED order must expire at end-of-run, never left dangling");
});

test("STOP_LIMIT_FILL: the stop triggers, and a LATER bar's favorable gap satisfies the limit — the full two-stage lifecycle completes with a real fill", () => {
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 104, 101.5, 103.5), // stop(103) triggers intrabar; TRIGGERED only (same as NO_FILL so far)
    bar(2, 105, 106, 104, 105.5), // still above the limit(102) -- remains TRIGGERED, unfilled
    bar(3, 100, 101, 99, 100.5), // NOW gaps back down through the limit(102) -- open(100) <= 102 -- favorable-gap fill at 100
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(102) }));
  assert.ok(result.eventStatistics.eventsByType["ORDER_TRIGGERED"]);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 100, "once TRIGGERED, the order is re-evaluated as a plain LIMIT on every subsequent bar until it fills or the run ends");
});
