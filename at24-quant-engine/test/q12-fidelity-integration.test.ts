import { test } from "node:test";
import assert from "node:assert/strict";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, modifyStopIntent, cancelIntent } from "./fixtures/q12-order-modification-fixtures.js";

/** No real child data — every parent bar falls back to D1 granularity (missingDetailPolicy), exercising D2's OWN code path without needing intrabar precision for these particular fixtures. */
const NO_CHILD_DATA = createStaticBarDetailProvider([], "M15", "q12-fallback-provider");

/**
 * Q0.12.25/26 — D1/D2/D3 integration. `multi-fidelity-engine.ts` has its
 * OWN independent copy of the Step 0.5/Step 1 modification+expiration
 * logic (Q0.6's own established "duplicate control flow, reuse frozen
 * functions" architecture — the SAME reason Q0.11 had to mirror its own
 * fix there). This time the mirror was applied proactively, alongside
 * the D1 change, rather than discovered afterward by a failing test —
 * these tests exist to PROVE that discipline held, not to find the gap
 * the hard way again.
 */

const STOP_BARS = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 104, 106, 99, 100)];

test("Q0.12.25: D1_OHLC correctly applies a scheduled MODIFY_STOP before fill resolution", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const base = {
    ...buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 2, intent: modifyStopIntent(orderId, 105, "raised the breakout level") }],
  };
  const result = runMultiFidelitySimulation(STOP_BARS, { base, fidelity: "D1_OHLC" });
  assert.equal(result.provenance.simulationFidelity, "D1_OHLC");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 105);
});

test("Q0.12.26: D2_LOWER_TIMEFRAME (falling back to parent-bar granularity for these bars) applies the IDENTICAL scheduled MODIFY_STOP", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const base = {
    ...buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 2, intent: modifyStopIntent(orderId, 105, "raised the breakout level") }],
  };
  const result = runMultiFidelitySimulation(STOP_BARS, { base, fidelity: "D2_LOWER_TIMEFRAME", detailProvider: NO_CHILD_DATA, detailTimeframe: "M15", missingDetailPolicy: "FALLBACK_TO_D1" });
  assert.equal(result.provenance.simulationFidelity, "D2_LOWER_TIMEFRAME");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 105, "the SAME modification must take effect identically under D2 — proving the mirror was applied correctly, not just to D1");
});

test("Q0.12.26: D1 and D2 carry IDENTICAL order intent — a cancellation prevents the fill under both fidelity tiers", () => {
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", STOP_BARS[0]!.timestamp);
  const base = {
    ...buildOrderTypeConfig(STOP_BARS, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 2, intent: cancelIntent(orderId, "abandoned the breakout thesis") }],
  };
  const d1 = runMultiFidelitySimulation(STOP_BARS, { base, fidelity: "D1_OHLC" });
  const d2 = runMultiFidelitySimulation(STOP_BARS, { base, fidelity: "D2_LOWER_TIMEFRAME", detailProvider: NO_CHILD_DATA, detailTimeframe: "M15", missingDetailPolicy: "FALLBACK_TO_D1" });
  assert.equal(d1.finalPositions.length, 0);
  assert.equal(d2.finalPositions.length, 0);
  assert.equal(d1.executionStatistics.ordersCancelled, 1);
  assert.equal(d2.executionStatistics.ordersCancelled, 1);
});
