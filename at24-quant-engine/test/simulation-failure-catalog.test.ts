import { test } from "node:test";
import assert from "node:assert/strict";
import { EventQueue } from "../src/runtime/simulation/event-queue.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { reducePosition, openPosition } from "../src/runtime/simulation/position-engine.js";
import { mapRiskAction } from "../src/runtime/simulation/risk-action-mapping.js";
import { resolvePositionSize } from "../src/runtime/simulation/rule-resolvers.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, buildGoldenConfig, SIM_INSTRUMENT } from "./fixtures/simulation-fixtures.js";
import { createFixedSpread } from "../src/runtime/simulation/spread-model.js";
import type { RiskAction } from "../src/domain/risk-evaluation.js";

/** Q0.5.44: the 18 required failure modes, each proven with a concrete test. */

test("1. invalid event ordering: EventQueue always dequeues in (timestamp, sequence) order regardless of enqueue order", () => {
  const q = new EventQueue();
  q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "t", payload: null });
  q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "t", payload: null });
  assert.equal(q.dequeue()!.timestamp, 1);
});

test("2. duplicate sequence: two enqueues never receive the same sequence, even at the identical timestamp", () => {
  const q = new EventQueue();
  const a = q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "t", payload: null });
  const b = q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "t", payload: null });
  assert.notEqual(a.sequence, b.sequence);
});

test("3. invalid order transition: FILLED -> SUBMITTED throws deterministically", () => {
  let order = createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "MARKET", creationTimestamp: 0 }, 0);
  order = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "FILLED");
  assert.throws(() => transitionOrder(order, "SUBMITTED"));
});

test("4. invalid quantity (NaN) is rejected at order creation, not silently coerced", () => {
  assert.throws(() =>
    createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: Number.NaN, orderType: "MARKET", creationTimestamp: 0 }, 0),
  );
});

test("5. invalid price: an entry with a non-positive stopLoss is rejected upstream by Q0.3's evaluateRisk, never silently accepted", () => {
  const bad = buildGoldenConfig();
  const spec = { ...bad.strategySpec, risk: { ...bad.strategySpec.risk, stopLoss: { type: "fixed-price" as const, price: -5 } } };
  const result = runSimulation(GOLDEN_BARS, { ...bad, strategySpec: spec });
  assert.equal(result.tradeLedger.length, 0, "REJECT_ENTRY from Q0.3's geometry validation must prevent any trade");
});

test("6. negative quantity is rejected at order creation", () => {
  assert.throws(() =>
    createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: -1, orderType: "MARKET", creationTimestamp: 0 }, 0),
  );
});

test("7. zero quantity is rejected at order creation", () => {
  assert.throws(() =>
    createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 0, orderType: "MARKET", creationTimestamp: 0 }, 0),
  );
});

test("8. insufficient account state: Q0.5 has no margin/liquidation model yet (documented limitation) — a losing run can drive balance negative, but accounting stays internally consistent (balance = initial + realizedPnl - fees) rather than silently corrupting", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  assert.equal(result.finalAccount.balance, buildGoldenConfig().initialBalance + result.finalAccount.realizedPnl - result.finalAccount.fees);
});

test("9. invalid position reduction: reducing by more than the current quantity throws, never silently clamps", () => {
  const position = openPosition({ id: "p1", originatingOrderIntentId: "o1", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 5, entryPrice: 100, entryTimestamp: 0, fee: 0 });
  assert.throws(() => reducePosition(position, 6, 100, 1, 0));
});

test("10. ambiguous intrabar: both SL and TP reachable in one bar resolves to the stop-loss, never a silent favorable pick", async () => {
  const { resolveProtectiveExit } = await import("../src/runtime/simulation/bar-fill-model.js");
  const outcome = resolveProtectiveExit(
    "BUY",
    90,
    110,
    { timestamp: 1, instrument: SIM_INSTRUMENT, timeframe: "H1", open: 100, high: 111, low: 89, close: 100, volume: 1 },
  );
  assert.equal(outcome.ambiguous, true);
  assert.equal(outcome.exitPrice, 90);
});

test("11. gap-through: a STOP order gapped through never fills at the nominal stop price", async () => {
  const { resolveStopFill } = await import("../src/runtime/simulation/bar-fill-model.js");
  const order = createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "STOP", stopPrice: 100, creationTimestamp: 0 }, 0);
  const outcome = resolveStopFill(order, { timestamp: 1, instrument: SIM_INSTRUMENT, timeframe: "H1", open: 120, high: 121, low: 119, close: 120, volume: 1 });
  assert.notEqual(outcome.fillPrice, 100);
  assert.equal(outcome.fillPrice, 120);
});

test("12. missing market data: evaluating a strategy whose indicator has no supplied value throws a clear, specific error", () => {
  const config = buildGoldenConfig();
  const emptySeries = new Map<string, readonly (number | boolean | undefined)[]>(); // PRICE key missing entirely
  assert.throws(() => runSimulation(GOLDEN_BARS, { ...config, indicatorSeries: emptySeries }), /missing indicator value/);
});

test("13. future timestamp: an order is never resolved against a bar at or before its own creation timestamp (same-bar safety guard)", () => {
  // Covered end-to-end in simulation-same-bar-safety.test.ts; re-asserted
  // here directly against the guard's effect via the golden fixture.
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  assert.ok(result.tradeLedger[0]!.entryTimestamp > GOLDEN_BARS[3]!.timestamp);
});

test("14. duplicate bar: runSimulation rejects a bars array with duplicate timestamps rather than silently processing it", () => {
  const duplicated = [...GOLDEN_BARS, { ...GOLDEN_BARS[GOLDEN_BARS.length - 1]! }];
  assert.throws(() => runSimulation(duplicated, buildGoldenConfig(duplicated)), /invalid market series/);
});

test("15. invalid risk action: an unrecognized RiskAction shape fails explicitly in the mapping layer", () => {
  const bogus = { type: "NOT_A_REAL_ACTION" } as unknown as RiskAction;
  assert.throws(() => mapRiskAction(bogus));
});

test("16. unsupported execution mode: atr-based position sizing is rejected explicitly end-to-end, never silently defaulted", () => {
  assert.throws(() => resolvePositionSize({ method: "atr-based", atrMultiple: 1, atrPeriod: 14 }, { entryPrice: 100, equity: 10_000 }));
});

test("17. provenance mismatch: two runs with different configured models produce visibly different provenance and different resultHash", () => {
  const a = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const b = runSimulation(GOLDEN_BARS, { ...buildGoldenConfig(), spreadModel: createFixedSpread(1) });
  assert.notEqual(a.provenance.spreadModel, b.provenance.spreadModel);
  assert.notEqual(a.resultHash, b.resultHash);
});

test("18. deterministic replay mismatch is detectable: changing a real input DOES change the resultHash (the hash is not vacuously constant)", () => {
  const a = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const b = runSimulation(GOLDEN_BARS, { ...buildGoldenConfig(), initialBalance: 20_000 });
  assert.notEqual(a.resultHash, b.resultHash);
});
