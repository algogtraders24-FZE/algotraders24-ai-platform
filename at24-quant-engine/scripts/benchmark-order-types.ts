/**
 * Q0.11.39 performance baseline for MARKET/LIMIT/STOP/STOP_LIMIT order
 * resolution and full-simulation execution. Correctness first — this is
 * a measurement script, not a gate; nothing here asserts a threshold.
 * Run with: npm run benchmark:order-types
 */
import { resolveMarketFill, resolveLimitFill, resolveStopFill, resolveStopLimitFill } from "../src/runtime/simulation/bar-fill-model.js";
import { createOrder } from "../src/runtime/simulation/order-engine.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { bar, absolute, buildOrderTypeConfig } from "../test/fixtures/q11-order-fixtures.js";

function time(label: string, fn: () => void, iterations: number): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / iterations) * 1000).toFixed(3)}us/op, N=${iterations})`);
}

console.log("AT24 Quant Engine — Q0.11 Order Type Performance Baseline\n");

const testBar = { timestamp: 0, instrument: { symbol: "X" }, timeframe: "H1" as const, open: 100, high: 102, low: 98, close: 101, volume: 1000 };
const marketOrder = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "MARKET", creationTimestamp: 0 }, 1);
const limitOrder = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, 1);
const stopOrder = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "STOP", stopPrice: 101.5, creationTimestamp: 0 }, 1);
const stopLimitOrder = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "STOP_LIMIT", stopPrice: 101.5, limitPrice: 103, creationTimestamp: 0 }, 1);

for (const N of [10_000, 100_000, 1_000_000]) {
  console.log(`\n--- N=${N} ---`);
  time("resolveMarketFill", () => { for (let i = 0; i < N; i++) resolveMarketFill(marketOrder, testBar, ZeroSpread, ZeroSlippage); }, N);
  time("resolveLimitFill", () => { for (let i = 0; i < N; i++) resolveLimitFill(limitOrder, testBar); }, N);
  time("resolveStopFill", () => { for (let i = 0; i < N; i++) resolveStopFill(stopOrder, testBar); }, N);
  time("resolveStopLimitFill", () => { for (let i = 0; i < N; i++) resolveStopLimitFill(stopLimitOrder, testBar); }, N);
}

// Full-simulation benchmark (smaller N given the whole event loop runs, not just one resolver call).
const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 104, 101.5, 103), bar(2, 103, 105, 102, 104)];
const stopLimitConfig = buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) });
const N_SIM = 5_000;
console.log(`\n--- Full simulation (3-bar, STOP_LIMIT) N=${N_SIM} ---`);
time("runSimulation", () => { for (let i = 0; i < N_SIM; i++) runSimulation(bars, stopLimitConfig); }, N_SIM);
