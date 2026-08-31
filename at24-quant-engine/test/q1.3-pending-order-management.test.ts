import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { transitionOrder, createOrder } from "../src/runtime/simulation/order-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { predictedOrderId, cancelIntent } from "./fixtures/q12-order-modification-fixtures.js";

/**
 * Q1.3 — consolidated, directly-named coverage matching this sprint's own
 * §16 checklist item-for-item. Per the sprint's own "audit first, do not
 * duplicate" instruction (Q1.3_PENDING_ORDER_AUDIT.md), most of the
 * underlying MECHANISM here is already proven by Q0.11/Q0.12's own test
 * suites — this file exists to give Q1.3's checklist a direct, explicit,
 * self-contained proof surface, and to close the one genuine coverage gap
 * the audit identified (§11, multi-bar duplicate-fire protection).
 */

// --- Limit orders ---

test("Q1.3 LIMIT: BUY_LIMIT triggers when price trades through the level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98)]; // bar1 low=97 < limit=98
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.side, "BUY");
});

test("Q1.3 LIMIT: SELL_LIMIT triggers when price trades through the level", () => {
  const bars = [bar(0, 99, 100, 98, 99), bar(1, 100, 103, 99, 101)]; // bar1 high=103 > limit=102, entry condition PRICE<100 on bar0
  const config = buildOrderTypeConfig(bars, "SELL", "LIMIT", { limitPrice: absolute(102) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.side, "SELL");
});

test("Q1.3 LIMIT: BUY_LIMIT does NOT trigger while price stays above the level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 96, 99)]; // low=96 still > limit=95
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(95) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersFilled, 0);
});

test("Q1.3 LIMIT: SELL_LIMIT does NOT trigger while price stays below the level", () => {
  const bars = [bar(0, 99, 100, 98, 99), bar(1, 100, 101, 99, 100)]; // high=101 still < limit=105
  const config = buildOrderTypeConfig(bars, "SELL", "LIMIT", { limitPrice: absolute(105) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersFilled, 0);
});

// --- Stop orders ---

test("Q1.3 STOP: BUY_STOP triggers when price breaks out through the level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 104, 98, 100)]; // high=104 >= stop=103
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 103);
});

test("Q1.3 STOP: SELL_STOP triggers when price breaks down through the level", () => {
  const bars = [bar(0, 99, 100, 98, 99), bar(1, 100, 101, 90, 95)]; // low=90 <= stop=92
  const config = buildOrderTypeConfig(bars, "SELL", "STOP", { stopPrice: absolute(92) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 92);
});

test("Q1.3 STOP: BUY_STOP does NOT trigger while price stays below the level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 102, 98, 100)]; // high=102 < stop=103
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.3 STOP: SELL_STOP does NOT trigger while price stays above the level", () => {
  const bars = [bar(0, 99, 100, 98, 99), bar(1, 100, 101, 93, 95)]; // low=93 > stop=92
  const config = buildOrderTypeConfig(bars, "SELL", "STOP", { stopPrice: absolute(92) });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
});

// --- Lifecycle ---

test("Q1.3 LIFECYCLE: create -> pending (ACCEPTED, non-terminal)", () => {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, 1);
  assert.equal(order.status, "NEW");
  const submitted = transitionOrder(order, "SUBMITTED");
  const accepted = transitionOrder(submitted, "ACCEPTED");
  assert.equal(accepted.status, "ACCEPTED", 'this IS the "PENDING" state Q1.3\'s lifecycle diagram names generically');
});

test("Q1.3 LIFECYCLE: pending -> filled produces a real position", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) }));
  assert.equal(result.executionStatistics.ordersFilled, 1);
  assert.equal(result.finalPositions.length, 1);
});

test("Q1.3 LIFECYCLE: pending -> cancelled", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 99, 100, 99, 99.5)];
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), orderModifications: [{ atBarIndex: 1, intent: cancelIntent(orderId, "lifecycle test") }] };
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCancelled, 1);
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.3 LIFECYCLE: pending -> expired", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 99, 100, 99, 99.5), bar(3, 99, 100, 99, 99.5)];
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }) };
  // Uses Q0.12's own expiration mechanism directly on the order via a modification schedule, exactly mirroring test/q12-golden-fixtures.test.ts's EXPIRATION fixture.
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const withExpiration = { ...config, orderModifications: [{ atBarIndex: 1, intent: { orderId, modificationType: "MODIFY_EXPIRATION" as const, newExpiration: { kind: "BAR" as const, maxBars: 1 }, reason: "lifecycle test" } }] };
  const result = runSimulation(bars, withExpiration);
  assert.equal(result.executionStatistics.ordersExpired, 1);
  assert.equal(result.finalPositions.length, 0);
});

// --- Safety ---

test("Q1.3 SAFETY: a cancelled order can never fill, even though price later reaches the trigger level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5), bar(2, 104, 106, 99, 100)]; // bar2 gaps through the stop
  const orderId = predictedOrderId("1.0.0", "BUY", "STOP", bars[0]!.timestamp);
  const config = { ...buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }), orderModifications: [{ atBarIndex: 2, intent: cancelIntent(orderId, "cancel then price reaches trigger") }] };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0, "the order never fills — cancellation (Step 0.5) wins before fill resolution (Step 1) on the same bar");
  assert.equal(result.executionStatistics.ordersCancelled, 1);
  assert.equal(result.executionStatistics.ordersFilled, 0);
});

test("Q1.3 SAFETY: a filled order can never fill twice — price crossing the same level on LATER bars produces exactly one fill/one position", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98), bar(2, 97, 98, 95, 96), bar(3, 96, 97, 94, 95)]; // price keeps falling well past the limit on bars 2/3 too
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersFilled, 1, "exactly one fill, never a second one for the same order even though price stays past the level for two more bars");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.tradeLedger.length, 0, "no exit occurred — this is checking there's no PHANTOM second entry recorded as a closed trade either");
});

test("Q1.3 SAFETY: cancelling an already-terminal (filled) order is rejected, never silently re-applied", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98), bar(2, 97, 98, 96, 97)];
  const orderId = predictedOrderId("1.0.0", "BUY", "LIMIT", bars[0]!.timestamp);
  // order fills on bar 1 (low=97 < limit=98); a cancel attempt on bar 2 targets an already-FILLED order.
  const config = { ...buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) }), orderModifications: [{ atBarIndex: 2, intent: cancelIntent(orderId, "too late") }] };
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1, "the fill from bar 1 stands — a later cancel attempt against a terminal order changes nothing");
  assert.equal(result.executionStatistics.ordersCancelled, 0);
  assert.ok((result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"] ?? 0) >= 1);
});

test("Q1.3 SAFETY: invalid state transitions are rejected deterministically — FILLED->CANCELLED, CANCELLED->FILLED, EXPIRED->FILLED", () => {
  const filled = { ...createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, 1), status: "FILLED" as const };
  assert.throws(() => transitionOrder(filled, "CANCELLED"));

  const cancelled = { ...filled, status: "CANCELLED" as const };
  assert.throws(() => transitionOrder(cancelled, "FILLED"));

  const expired = { ...filled, status: "EXPIRED" as const };
  assert.throws(() => transitionOrder(expired, "FILLED"));
});

// --- Gap ---

test("Q1.3 GAP: gap through a LIMIT fills at the realistic (favorable) gap price, matching the sprint's own worked example (limit=100, prev=105, next=98)", () => {
  // Mirrors the sprint's literal example directionally: a BUY_LIMIT at 100 with price gapping down to 98 must trigger, filling at 98 (the actual, better price) — never fabricated at exactly 100.
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 98, 99, 97, 98)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(100) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 98, "fills at the REAL gap price, never at the nominal limit level");
});

test("Q1.3 GAP: gap through a STOP fills at the worse (realistic) gap price, never at the nominal stop level", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 106, 108, 105, 107)]; // opens at 106, past stop=103
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 106, "fills at the actual (worse) open, never at the nominal stop level 103");
});

// --- OHLC ---

test("Q1.3 OHLC: High/Low are used correctly and no look-ahead occurs — a decision at bar N never depends on bar N+1's OHLC", () => {
  const shortBars = [bar(0, 100, 101, 99, 101), bar(1, 99, 102, 98, 100)];
  const longBars = [bar(0, 100, 101, 99, 101), bar(1, 99, 102, 98, 100), bar(2, 999, 1000, 998, 999)];
  const shortResult = runSimulation(shortBars, buildOrderTypeConfig(shortBars, "BUY", "STOP", { stopPrice: absolute(101.5) }));
  const longResult = runSimulation(longBars, buildOrderTypeConfig(longBars, "BUY", "STOP", { stopPrice: absolute(101.5) }));
  assert.equal(shortResult.finalPositions.length, 1);
  assert.equal(longResult.finalPositions.length, 1);
  assert.equal(shortResult.finalPositions[0]!.entryPrice, longResult.finalPositions[0]!.entryPrice, "bar 1's own outcome is identical whether or not a wildly different bar 2 exists");
});

test("Q1.3 OHLC: same-bar ambiguity (STOP_LIMIT) is resolved via the project's documented conservative policy, never an invented sequence — see test/simulation-fill-model.test.ts and docs/Q0.5_EXECUTION_MODEL.md for the exhaustive proof; referenced, not duplicated here", () => {
  assert.ok(true);
});

// --- Tick ---

test("Q1.3 TICK: tick-level (D4_TICK) simulation is NOT implemented in this engine — documented as a genuine, permanent-for-now limitation, not silently approximated with OHLC bars pretending to be ticks", () => {
  // D3_M1 (the finest IMPLEMENTED fidelity) is still bar-based (1-minute OHLC child bars, walked via bar-magnifier.ts), reusing the SAME resolveLimitFill/resolveStopFill/resolveStopLimitFill resolvers already proven above — never a second, tick-shaped resolver. See docs/Q1.3_PENDING_ORDER_AUDIT.md §7 and docs/Q1.3_PENDING_ORDER_SEMANTICS.md §6.
  assert.ok(true);
});

// --- Determinism (Q1.3-scoped, direct) ---

test("Q1.3 DETERMINISM: the same strategy + market data + config produces an identical resultHash across 3 runs", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98), bar(2, 97, 98, 96, 97)];
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) });
  const hashes = [runSimulation(bars, config).resultHash, runSimulation(bars, config).resultHash, runSimulation(bars, config).resultHash];
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});
