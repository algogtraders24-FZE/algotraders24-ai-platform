/**
 * Q0.5.45 performance baseline for the Event-Driven Simulation Core.
 * Correctness first — this is a measurement script, not a gate; nothing
 * here asserts a threshold or fails the build. Run with:
 *   npm run benchmark:simulation
 */
import { EventQueue } from "../src/runtime/simulation/event-queue.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { resolveMarketFill, resolveLimitFill } from "../src/runtime/simulation/bar-fill-model.js";
import { openPosition, reducePosition } from "../src/runtime/simulation/position-engine.js";
import { createAccount, applyFill } from "../src/runtime/simulation/account-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import type { Instrument, OHLCVBar, Timeframe } from "../src/domain/market-data.js";
import { GOLDEN_BARS, buildGoldenConfig } from "../test/fixtures/simulation-fixtures.js";

const N = 100_000;
const INSTRUMENT: Instrument = { symbol: "BENCH", assetClass: "other" };
const TIMEFRAME: Timeframe = "H1";

function bar(overrides: Partial<OHLCVBar> = {}): OHLCVBar {
  return { timestamp: 1, instrument: INSTRUMENT, timeframe: TIMEFRAME, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides };
}

function time(label: string, iterations: number, fn: () => void): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms total, ${((ms / iterations) * 1000).toFixed(3)}us/op (N=${iterations})`);
}

console.log(`AT24 Quant Engine — Q0.5 Simulation Core Performance Baseline (N=${N})\n`);

time("EventQueue enqueue+dequeue", N, () => {
  const q = new EventQueue();
  for (let i = 0; i < N; i++) q.enqueue({ timestamp: i, eventType: "MARKET_BAR", source: "bench", payload: null });
  while (!q.isEmpty()) q.dequeue();
});

time("Order create + full valid lifecycle transition", N, () => {
  for (let i = 0; i < N; i++) {
    let order = createOrder({ strategyVersion: "1.0.0", instrument: INSTRUMENT, side: "BUY", quantity: 1, orderType: "MARKET", creationTimestamp: i }, i);
    order = transitionOrder(order, "SUBMITTED");
    order = transitionOrder(order, "ACCEPTED");
    order = transitionOrder(order, "FILLED", { filledQuantity: 1, averageFillPrice: 100 });
  }
});

time("MARKET fill resolution", N, () => {
  const o = createOrder({ strategyVersion: "1.0.0", instrument: INSTRUMENT, side: "BUY", quantity: 1, orderType: "MARKET", creationTimestamp: 0 }, 0);
  for (let i = 0; i < N; i++) resolveMarketFill(o, bar({ open: 100 + (i % 10) }), ZeroSpread, ZeroSlippage);
});

time("LIMIT fill evaluation (touch/no-fill case)", N, () => {
  const o = createOrder({ strategyVersion: "1.0.0", instrument: INSTRUMENT, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 100, creationTimestamp: 0 }, 0);
  for (let i = 0; i < N; i++) resolveLimitFill(o, bar({ open: 105, low: 103, high: 106 }));
});

time("Position open + reduce (full close)", N, () => {
  for (let i = 0; i < N; i++) {
    const p = openPosition({ id: `p${i}`, originatingOrderIntentId: `o${i}`, instrument: INSTRUMENT, side: "BUY", quantity: 1, entryPrice: 100, entryTimestamp: 0, fee: 0 });
    reducePosition(p, 1, 105, 1, 0);
  }
});

time("Account applyFill", N, () => {
  let account = createAccount(10_000, 0);
  for (let i = 0; i < N; i++) account = applyFill(account, 1, 0.1, i);
});

const SIM_ITERATIONS = 1_000;
time(`Full end-to-end simulation (golden fixture, ${GOLDEN_BARS.length} bars)`, SIM_ITERATIONS, () => {
  for (let i = 0; i < SIM_ITERATIONS; i++) runSimulation(GOLDEN_BARS, buildGoldenConfig());
});
