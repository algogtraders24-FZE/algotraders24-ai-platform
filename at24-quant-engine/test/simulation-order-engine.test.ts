import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, transitionOrder, isTerminal, VALID_TRANSITIONS } from "../src/runtime/simulation/order-engine.js";
import type { Instrument } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "X" };

function baseInput(overrides: Partial<Parameters<typeof createOrder>[0]> = {}) {
  return {
    strategyVersion: "1.0.0",
    instrument: INSTRUMENT,
    side: "BUY" as const,
    quantity: 1,
    orderType: "MARKET" as const,
    creationTimestamp: 1000,
    ...overrides,
  };
}

test("createOrder produces a deterministic orderId from its inputs, no randomness", () => {
  const order = createOrder(baseInput(), 5);
  assert.equal(order.orderId, "1.0.0:X:BUY:MARKET:1000:5");
});

test("identical inputs and sequence produce an identical orderId across calls", () => {
  const a = createOrder(baseInput(), 5);
  const b = createOrder(baseInput(), 5);
  assert.equal(a.orderId, b.orderId);
});

test("createOrder rejects zero/negative/non-finite quantity", () => {
  assert.throws(() => createOrder(baseInput({ quantity: 0 }), 0));
  assert.throws(() => createOrder(baseInput({ quantity: -1 }), 0));
  assert.throws(() => createOrder(baseInput({ quantity: Number.NaN }), 0));
});

test("LIMIT/STOP_LIMIT require limitPrice; STOP/STOP_LIMIT require stopPrice", () => {
  assert.throws(() => createOrder(baseInput({ orderType: "LIMIT" }), 0));
  assert.throws(() => createOrder(baseInput({ orderType: "STOP" }), 0));
  assert.throws(() => createOrder(baseInput({ orderType: "STOP_LIMIT", stopPrice: 100 }), 0));
  assert.doesNotThrow(() => createOrder(baseInput({ orderType: "LIMIT", limitPrice: 100 }), 0));
  assert.doesNotThrow(() => createOrder(baseInput({ orderType: "STOP", stopPrice: 100 }), 0));
  assert.doesNotThrow(() => createOrder(baseInput({ orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 101 }), 0));
});

test("new order starts in NEW status with zero filled quantity", () => {
  const order = createOrder(baseInput(), 0);
  assert.equal(order.status, "NEW");
  assert.equal(order.filledQuantity, 0);
});

test("every valid transition in the frozen Q0.4 lifecycle succeeds", () => {
  let order = createOrder(baseInput(), 0);
  order = transitionOrder(order, "SUBMITTED");
  order = transitionOrder(order, "ACCEPTED");
  order = transitionOrder(order, "TRIGGERED");
  order = transitionOrder(order, "PARTIALLY_FILLED");
  order = transitionOrder(order, "FILLED");
  assert.equal(order.status, "FILLED");
});

test("FILLED -> NEW is an invalid transition and throws", () => {
  let order = createOrder(baseInput(), 0);
  order = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "FILLED");
  assert.throws(() => transitionOrder(order, "NEW"));
});

test("CANCELLED -> FILLED is an invalid transition and throws", () => {
  let order = createOrder(baseInput(), 0);
  order = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "CANCELLED");
  assert.throws(() => transitionOrder(order, "FILLED"));
});

test("REJECTED -> FILLED is an invalid transition and throws", () => {
  let order = createOrder(baseInput(), 0);
  order = transitionOrder(transitionOrder(order, "SUBMITTED"), "REJECTED");
  assert.throws(() => transitionOrder(order, "FILLED"));
});

test("SUBMITTED -> TRIGGERED is invalid (must go through ACCEPTED first)", () => {
  const order = transitionOrder(createOrder(baseInput(), 0), "SUBMITTED");
  assert.throws(() => transitionOrder(order, "TRIGGERED"));
});

test("transitionOrder never mutates the input order", () => {
  const order = createOrder(baseInput(), 0);
  const snapshot = JSON.stringify(order);
  transitionOrder(order, "SUBMITTED");
  assert.equal(JSON.stringify(order), snapshot);
});

test("all four terminal statuses have zero outgoing transitions", () => {
  for (const status of ["FILLED", "CANCELLED", "EXPIRED", "REJECTED"] as const) {
    assert.equal(isTerminal(status), true);
    assert.deepEqual(VALID_TRANSITIONS[status], []);
  }
});

test("NEW and PARTIALLY_FILLED are not terminal", () => {
  assert.equal(isTerminal("NEW"), false);
  assert.equal(isTerminal("PARTIALLY_FILLED"), false);
});
