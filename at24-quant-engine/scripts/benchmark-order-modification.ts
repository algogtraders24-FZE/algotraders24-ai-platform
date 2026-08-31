/**
 * Q0.12.40 performance baseline for order create/modify/cancel/replace.
 * Correctness first — this is a measurement script, not a gate; nothing
 * here asserts a threshold. Run with: npm run benchmark:order-modification
 */
import { createOrder, transitionOrder, isOrderExpired } from "../src/runtime/simulation/order-engine.js";
import { validateOrderModification } from "../src/domain/simulation/order-modification.js";
import { applyOrderModification } from "../src/runtime/simulation/order-modification.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "../test/fixtures/q11-order-fixtures.js";
import { predictedOrderId, modifyStopIntent } from "../test/fixtures/q12-order-modification-fixtures.js";

function time(label: string, fn: () => void, iterations: number): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / iterations) * 1000).toFixed(3)}us/op, N=${iterations})`);
}

console.log("AT24 Quant Engine — Q0.12 Order Modification Performance Baseline\n");

const acceptedOrder = transitionOrder(
  transitionOrder(createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, 1), "SUBMITTED"),
  "ACCEPTED",
);
const modifyIntent = { orderId: acceptedOrder.orderId, modificationType: "MODIFY_LIMIT" as const, newLimitPrice: 98, reason: "benchmark" };
const cancelIntentObj = { orderId: acceptedOrder.orderId, modificationType: "CANCEL" as const, reason: "benchmark" };
const replaceIntentObj = { orderId: acceptedOrder.orderId, modificationType: "REPLACE" as const, newLimitPrice: 97, reason: "benchmark" };

for (const N of [10_000, 100_000, 1_000_000]) {
  console.log(`\n--- N=${N} ---`);
  time("createOrder", () => { for (let i = 0; i < N; i++) createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, i); }, N);
  time("validateOrderModification (MODIFY_LIMIT)", () => { for (let i = 0; i < N; i++) validateOrderModification(acceptedOrder, modifyIntent, 100); }, N);
  time("applyOrderModification (MODIFY_LIMIT)", () => { for (let i = 0; i < N; i++) applyOrderModification(acceptedOrder, modifyIntent, 0); }, N);
  time("applyOrderModification (CANCEL)", () => { for (let i = 0; i < N; i++) applyOrderModification(acceptedOrder, cancelIntentObj, 0); }, N);
  time("applyOrderModification (REPLACE)", () => { for (let i = 0; i < N; i++) applyOrderModification(acceptedOrder, replaceIntentObj, 0); }, N);
  time("isOrderExpired (BAR policy)", () => { for (let i = 0; i < N; i++) isOrderExpired({ ...acceptedOrder, expiration: { kind: "BAR", maxBars: 5 } }, { asOf: 0, currentBarIndex: 3, creationBarIndex: 0 }); }, N);
}

// Full-simulation benchmark (smaller N given the whole event loop runs, not just one resolver call).
const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 98, 99.5), bar(2, 104, 106, 99, 100)];
const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
const config = {
  ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }),
  orderModifications: [{ atBarIndex: 2, intent: modifyStopIntent(orderId, 105, "benchmark") }],
};
const N_SIM = 5_000;
console.log(`\n--- Full simulation (3-bar, STOP + MODIFY_STOP) N=${N_SIM} ---`);
time("runSimulation", () => { for (let i = 0; i < N_SIM; i++) runSimulation(bars, config); }, N_SIM);
