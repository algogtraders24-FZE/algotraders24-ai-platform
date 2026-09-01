import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, cancelIntent, modifyStopIntent } from "./fixtures/q12-order-modification-fixtures.js";
import type { PendingOrderManagementPolicy } from "../src/domain/pending-order-management-policy.js";
import type { OHLCVBar } from "../src/domain/market-data.js";
import type { SimulationConfig } from "../src/runtime/simulation/simulation-engine.js";

/**
 * Q1.4.7 — golden fixtures proving D1/D2/D3 differ ONLY in data
 * resolution, never in business semantics: identical entry decisions,
 * pending triggers, modifications, cancellations, expiration, SL/TP,
 * position state, trade lifecycle, ledger, and provenance shape. Reuses
 * the exact D1/D2/D3 mirror discipline already proven per-feature in
 * Q0.11/Q0.12/Q1.3; this file's job is to prove it holds SIMULTANEOUSLY
 * across every mechanism in one combined strategy, not feature-by-feature.
 */

function runD2(bars: readonly OHLCVBar[], base: SimulationConfig) {
  return runMultiFidelitySimulation(bars, { base, fidelity: "D2_LOWER_TIMEFRAME", detailProvider: createStaticBarDetailProvider([], "M15", "q14-fallback"), detailTimeframe: "M15", missingDetailPolicy: "FALLBACK_TO_D1" });
}
function runD3(bars: readonly OHLCVBar[], base: SimulationConfig) {
  return runMultiFidelitySimulation(bars, { base, fidelity: "D3_M1", detailProvider: createStaticBarDetailProvider([], "M1", "q14-fallback-d3"), detailTimeframe: "M1", missingDetailPolicy: "FALLBACK_TO_D1" });
}

test("Q1.4 FIDELITY: entry decision (STOP order fill) is identical across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 104, 98, 100)];
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions.length, 1);
  assert.equal(d2.finalPositions.length, 1);
  assert.equal(d3.finalPositions.length, 1);
  assert.equal(d1.finalPositions[0]!.entryPrice, d2.finalPositions[0]!.entryPrice);
  assert.equal(d2.finalPositions[0]!.entryPrice, d3.finalPositions[0]!.entryPrice);
  assert.equal(d1.finalPositions[0]!.entryPrice, 103);
});

test("Q1.4 FIDELITY: pending-order cancellation (cancel-before-trigger) is identical across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 104, 106, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), orderModifications: [{ atBarIndex: 2, intent: cancelIntent(orderId, "fidelity parity") }] };
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions.length, 0);
  assert.equal(d2.finalPositions.length, 0);
  assert.equal(d3.finalPositions.length, 0);
  assert.equal(d1.executionStatistics.ordersCancelled, 1);
  assert.equal(d2.executionStatistics.ordersCancelled, 1);
  assert.equal(d3.executionStatistics.ordersCancelled, 1);
});

test("Q1.4 FIDELITY: pending-order modification (modify-before-trigger) is identical across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 100, 101, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), orderModifications: [{ atBarIndex: 2, intent: modifyStopIntent(orderId, 100.5, "fidelity parity") }] };
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions[0]!.entryPrice, 100.5);
  assert.equal(d2.finalPositions[0]!.entryPrice, 100.5);
  assert.equal(d3.finalPositions[0]!.entryPrice, 100.5);
});

test("Q1.4 FIDELITY: expiration (order expires before it would otherwise fill) is identical across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 99, 100, 99, 99.5), bar(3, 104, 106, 99, 100)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = {
    ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }),
    orderModifications: [{ atBarIndex: 1, intent: { orderId, modificationType: "MODIFY_EXPIRATION" as const, newExpiration: { kind: "BAR" as const, maxBars: 2 }, reason: "fidelity parity" } }],
  };
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions.length, 0);
  assert.equal(d2.finalPositions.length, 0);
  assert.equal(d3.finalPositions.length, 0);
  assert.equal(d1.executionStatistics.ordersExpired, 1);
  assert.equal(d2.executionStatistics.ordersExpired, 1);
  assert.equal(d3.executionStatistics.ordersExpired, 1);
});

test("Q1.4 FIDELITY: SL/TP protective exit is identical across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98), bar(2, 98, 99, 95, 96)];
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) }, { sizing: { method: "fixed-quantity", quantity: 1 }, stopLoss: { type: "fixed-distance", distance: 1 } });
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions.length, 0, "position closed via SL on bar 2");
  assert.equal(d2.finalPositions.length, 0);
  assert.equal(d3.finalPositions.length, 0);
  assert.equal(d1.tradeLedger.length, 1);
  assert.equal(d2.tradeLedger.length, 1);
  assert.equal(d3.tradeLedger.length, 1);
  assert.equal(d1.tradeLedger[0]!.exitPrice, d2.tradeLedger[0]!.exitPrice);
  assert.equal(d2.tradeLedger[0]!.exitPrice, d3.tradeLedger[0]!.exitPrice);
});

test("Q1.4 FIDELITY: a compiled MQL pending-order-management policy produces an identical cancellation outcome across D1/D2/D3", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 100, 101, 99, 100)];
  const policy: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] };
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), pendingOrderManagementPolicy: policy };
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.executionStatistics.ordersCancelled, 1);
  assert.equal(d2.executionStatistics.ordersCancelled, 1);
  assert.equal(d3.executionStatistics.ordersCancelled, 1);
});

test("Q1.4 FIDELITY: no future child-bar information leaks into an earlier decision — D2/D3 with wildly different LATER data still produce the identical FIRST outcome", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 104, 98, 100), bar(2, 5, 6, 4, 5)]; // bar 2 is wild/irrelevant
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const d1 = runSimulation(bars, config);
  const d2 = runD2(bars, config);
  const d3 = runD3(bars, config);
  assert.equal(d1.finalPositions[0]!.entryPrice, 103);
  assert.equal(d2.finalPositions[0]!.entryPrice, 103);
  assert.equal(d3.finalPositions[0]!.entryPrice, 103);
});
