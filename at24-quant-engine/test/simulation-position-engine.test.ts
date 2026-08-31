import { test } from "node:test";
import assert from "node:assert/strict";
import { openPosition, increasePosition, reducePosition, closePosition, computeUnrealizedPnl } from "../src/runtime/simulation/position-engine.js";
import type { Instrument } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "X" };

function open(overrides: Partial<Parameters<typeof openPosition>[0]> = {}) {
  return openPosition({
    id: "p1",
    originatingOrderIntentId: "o1",
    instrument: INSTRUMENT,
    side: "BUY",
    quantity: 10,
    entryPrice: 100,
    entryTimestamp: 0,
    fee: 1,
    ...overrides,
  });
}

test("open: LONG (BUY)", () => {
  const p = open({ side: "BUY" });
  assert.equal(p.status, "OPEN");
  assert.equal(p.side, "BUY");
  assert.equal(p.quantity, 10);
  assert.equal(p.fees, 1);
});

test("open: SHORT (SELL)", () => {
  const p = open({ side: "SELL" });
  assert.equal(p.side, "SELL");
});

test("open rejects non-positive quantity", () => {
  assert.throws(() => open({ quantity: 0 }));
  assert.throws(() => open({ quantity: -5 }));
});

test("increase: recomputes volume-weighted average entry price", () => {
  const p = open({ quantity: 10, entryPrice: 100 });
  const increased = increasePosition(p, 10, 110, 1, 0.5);
  assert.equal(increased.quantity, 20);
  assert.equal(increased.entryPrice, 105); // (100*10 + 110*10)/20
  assert.equal(increased.fees, 1.5);
});

test("increase rejects non-positive addQuantity and a non-OPEN position", () => {
  const p = open();
  assert.throws(() => increasePosition(p, 0, 100, 1, 0));
  const { position: closed } = closePosition(p, 100, 1, 0);
  assert.throws(() => increasePosition(closed, 1, 100, 1, 0));
});

test("reduce: partial close computes gross P&L for the reduced quantity only, position stays OPEN", () => {
  const p = open({ side: "BUY", quantity: 10, entryPrice: 100 });
  const { position, grossPnl } = reducePosition(p, 4, 110, 5, 0.2);
  assert.equal(grossPnl, 40); // (110-100)*4
  assert.equal(position.status, "OPEN");
  assert.equal(position.quantity, 6);
  assert.equal(position.realizedPnl, 40);
  assert.equal(position.fees, 1.2);
});

test("reduce: reducing the full quantity closes the position", () => {
  const p = open({ quantity: 10, entryPrice: 100 });
  const { position } = reducePosition(p, 10, 105, 5, 0);
  assert.equal(position.status, "CLOSED");
  assert.equal(position.quantity, 0);
  assert.equal(position.exitPrice, 105);
  assert.equal(position.exitTimestamp, 5);
});

test("reduce: SELL side P&L direction is inverted", () => {
  const p = open({ side: "SELL", quantity: 10, entryPrice: 100 });
  const { grossPnl } = reducePosition(p, 10, 90, 5, 0); // price fell -> profit for a short
  assert.equal(grossPnl, 100);
});

test("reduce: quantity <= 0 is rejected", () => {
  const p = open();
  assert.throws(() => reducePosition(p, 0, 100, 1, 0));
  assert.throws(() => reducePosition(p, -1, 100, 1, 0));
});

test("reduce: quantity > current position quantity is rejected (Q0.5.20)", () => {
  const p = open({ quantity: 5 });
  assert.throws(() => reducePosition(p, 6, 100, 1, 0));
});

test("close is equivalent to reducing by the full remaining quantity", () => {
  const p = open({ quantity: 10, entryPrice: 100 });
  const viaClose = closePosition(p, 110, 5, 0);
  const viaReduce = reducePosition(p, 10, 110, 5, 0);
  assert.deepEqual(viaClose, viaReduce);
});

test("computeUnrealizedPnl reflects direction and is 0 for a CLOSED position", () => {
  const long = open({ side: "BUY", quantity: 10, entryPrice: 100 });
  assert.equal(computeUnrealizedPnl(long, 110), 100);
  const short = open({ side: "SELL", quantity: 10, entryPrice: 100 });
  assert.equal(computeUnrealizedPnl(short, 90), 100);
  const { position: closed } = closePosition(long, 110, 1, 0);
  assert.equal(computeUnrealizedPnl(closed, 999), 0);
});

test("multiple sequential trades on independent Position objects never cross-contaminate (pure functions)", () => {
  const p1 = open({ id: "p1", entryPrice: 100 });
  const p2 = open({ id: "p2", entryPrice: 200 });
  const r1 = reducePosition(p1, 10, 105, 1, 0);
  const r2 = reducePosition(p2, 10, 210, 1, 0);
  assert.equal(r1.grossPnl, 50);
  assert.equal(r2.grossPnl, 100);
});
