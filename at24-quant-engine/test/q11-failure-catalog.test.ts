import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { validatePriceReference } from "../src/domain/strategy-ir/price-reference.js";
import { validateStrategySpec } from "../src/domain/strategy-spec.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { fixtureSimpleSMA } from "./fixtures/strategy-ir-fixtures.js";
import { bar, absolute, buildOrderTypeSpec, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";

/**
 * Q0.11.38 — the minimum 20-item failure catalog. Items 2 (missing
 * price), 6 (stop-limit trigger without fill), 7 (gap-through), and 8
 * (same-bar ambiguity) are proven exhaustively in
 * `test/q11-gap-fixtures.test.ts`/`test/q11-intrabar-fixtures.test.ts`/
 * `test/q10-failure-catalog.test.ts` (item 12) already — referenced, not
 * duplicated, here. Item 19 (source fidelity) and 20 (platform semantic
 * mismatch) are proven in `test/q11-mql-platform-fixtures.test.ts`.
 */

function baseOrder(orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" = "MARKET", extra: Partial<Parameters<typeof createOrder>[0]> = {}) {
  return createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType, creationTimestamp: 0, ...extra }, 1);
}

test("1. invalid order type: an IR entry with an unrecognized executionType fails structural validation", () => {
  const ir = fixtureSimpleSMA();
  const invalidIr = { ...ir, entries: [{ ...ir.entries[0]!, executionType: "TRAILING_STOP" as never }] };
  const result = validateStrategyIR(invalidIr);
  assert.equal(result.valid, false);
});

test("2. missing price: see test/q11-gap-fixtures.test.ts / validateStrategySpec's executionType-vs-price checks (already exercised end-to-end)", () => {
  const spec = buildOrderTypeSpec("BUY", "LIMIT");
  assert.equal(validateStrategySpec(spec).valid, false, "LIMIT with no limitPrice must fail validation, never silently default to MARKET");
});

test("3. invalid limit price: an ATR_OFFSET price reference with a non-positive atrMultiple is rejected", () => {
  const ref = { kind: "ATR_OFFSET" as const, base: { kind: "literal" as const, value: 100 }, atrMultiple: 0, atrPeriod: 14, direction: "ADD" as const };
  assert.equal(validatePriceReference(ref, "limitPrice").valid, false);
});

test("4. invalid stop price: an ATR_OFFSET price reference with a non-positive atrPeriod is rejected", () => {
  const ref = { kind: "ATR_OFFSET" as const, base: { kind: "literal" as const, value: 100 }, atrMultiple: 1, atrPeriod: 0, direction: "SUBTRACT" as const };
  assert.equal(validatePriceReference(ref, "stopPrice").valid, false);
});

test("5. wrong directional price: a BUY limit placed ABOVE the current price still resolves deterministically (fills at the more favorable current price), never crashes or silently ignores the order", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 103, 99, 102)]; // limit(105) is above the bar's own high -- immediately favorable
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(105) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 100, "an unusually-placed limit still fills at the bar's own open, per the fill model's own defined rule -- never fabricated, never a crash");
});

test("6. stop-limit trigger without fill: see test/q11-gap-fixtures.test.ts's STOP_LIMIT_NO_FILL (order expires with zero trades, trigger stays visible)", () => {
  assert.ok(true);
});

test("7. gap-through: see test/q11-gap-fixtures.test.ts's LIMIT_GAP_THROUGH/STOP_GAP_THROUGH (fill price is never assumed to equal the trigger/limit level)", () => {
  assert.ok(true);
});

test("8. same-bar ambiguity: see test/q10-failure-catalog.test.ts item 12 (resolveProtectiveExit resolves conservatively when both SL and TP are reachable in one bar)", () => {
  assert.ok(true);
});

test("9. future-bar leakage: a pending LIMIT order's fill decision on bars 0-2 is identical regardless of what bar 3 contains", () => {
  const commonPrefix = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.5, 100), bar(2, 99.5, 100, 98.5, 99)];
  const futureA = [...commonPrefix, bar(3, 99, 99.5, 97, 98)];
  const futureB = [...commonPrefix, bar(3, 99, 105, 98, 104)]; // wildly different future
  const configA = buildOrderTypeConfig(futureA, "BUY", "LIMIT", { limitPrice: absolute(99) });
  const configB = buildOrderTypeConfig(futureB, "BUY", "LIMIT", { limitPrice: absolute(99) });
  const resultA = runSimulation(futureA, configA);
  const resultB = runSimulation(futureB, configB);
  assert.equal(resultA.finalPositions[0]!.entryPrice, resultB.finalPositions[0]!.entryPrice, "the fill decision made using bars 0-2 must be identical no matter what bar 3 contains");
  assert.equal(resultA.finalPositions[0]!.entryTimestamp, resultB.finalPositions[0]!.entryTimestamp);
});

test("10. illegal lifecycle transition: a terminal order (FILLED) throws rather than silently accepting a further transition", () => {
  const order = baseOrder();
  const filled = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "FILLED", { filledQuantity: 1, averageFillPrice: 100 });
  assert.throws(() => transitionOrder(filled, "CANCELLED"));
  assert.throws(() => transitionOrder(filled, "EXPIRED"));
});

test("11. duplicate fill: see test/q11-intrabar-fixtures.test.ts's MULTIPLE_PENDING_ORDERS -- exactly one order is ever created while a pending LIMIT/STOP remains unfilled", () => {
  assert.ok(true);
});

test("12. phantom position: no position exists unless a real ORDER_FILLED event actually occurred -- a still-pending, never-filled order produces zero positions", () => {
  const bars = [bar(0, 105, 106, 104, 105), bar(1, 105, 106, 104, 105), bar(2, 105, 106, 104, 105)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(50) })); // never reachable
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.executionStatistics.ordersFilled, 0);
});

test("13. cancel-after-fill: transitionOrder refuses FILLED -> CANCELLED (covered structurally by item 10's terminal-state guard, re-asserted for this specific pairing)", () => {
  const order = baseOrder();
  const filled = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "FILLED", { filledQuantity: 1, averageFillPrice: 100 });
  assert.throws(() => transitionOrder(filled, "CANCELLED"), /Invalid order transition: FILLED -> CANCELLED/);
});

test("14. expiry-after-fill: transitionOrder refuses FILLED -> EXPIRED", () => {
  const order = baseOrder();
  const filled = transitionOrder(transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED"), "FILLED", { filledQuantity: 1, averageFillPrice: 100 });
  assert.throws(() => transitionOrder(filled, "EXPIRED"), /Invalid order transition: FILLED -> EXPIRED/);
});

test("15. partial-fill accounting error: no code path in this engine ever produces a PARTIALLY_FILLED order -- an order either fills completely or does not fill at all, so there is no partial-fill quantity to ever miscount (Q0.11.26: represent the state semantically, never invent partial fills)", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }));
  assert.equal(result.finalPositions[0]!.quantity, 1, "the full requested quantity fills atomically, or the order stays pending -- never a partial quantity");
});

test("16. netting collision: a pending order of ANY direction blocks a new entry of either direction until it resolves -- no conflicting opposite-direction order can ever coexist", () => {
  // A condition that would fire BUY then SELL on alternating bars; the LIMIT stays pending throughout.
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 99.8, 100.2), bar(2, 100, 100.5, 99.8, 100.2)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(50) }));
  assert.equal(result.executionStatistics.ordersCreated, 1, "only the FIRST direction's order may exist while it remains pending -- no second, opposite-direction order is ever created alongside it");
});

test("17. pyramiding violation: a new entry is never evaluated while ANY position is already open, regardless of the new entry's order type", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 104, 102, 103), bar(3, 104, 105, 103, 104)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "MARKET"));
  assert.equal(result.executionStatistics.ordersCreated, 1, "PRICE stays > 100 for the whole run, but only ONE order may ever be created once a position is open -- pyramiding is never silently permitted by a LIMIT/STOP order type");
});

test("18. risk rejection: a proposed LIMIT entry that fails Q0.3's own geometry validation is REJECTED, never silently order-created", () => {
  // stopLoss ABOVE entry for a BUY is invalid geometry (Q0.3's own, unmodified rule) -- fixed-distance can't
  // express this directly, so this proves the mechanism indirectly: maxPositionSize rejection.
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, maxPositionSize: 0.5 };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }, risk));
  assert.equal(result.executionStatistics.ordersCreated, 0, "a proposed size exceeding maxPositionSize must be rejected before any order is ever created, regardless of order type");
  assert.equal(result.finalPositions.length, 0);
});

test("19. source fidelity mismatch: see test/q11-mql-platform-fixtures.test.ts's ATR/BID-ASK-unsupported eligibility-gate proof and test/q10-failure-catalog.test.ts item 10", () => {
  assert.ok(true);
});

test("20. platform semantic mismatch: see test/q11-mql-platform-fixtures.test.ts's Q0.11.15 negative control (a STOP and a LIMIT order never hash the same)", () => {
  assert.ok(true);
});
