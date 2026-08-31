import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStopLossPrice, resolveTakeProfitPrice, resolvePositionSize } from "../src/runtime/simulation/rule-resolvers.js";

test("resolveStopLossPrice: fixed-price returns the literal price", () => {
  assert.equal(resolveStopLossPrice({ type: "fixed-price", price: 95 }, "BUY", 100, undefined), 95);
});

test("resolveStopLossPrice: fixed-distance below entry for BUY, above for SELL", () => {
  assert.equal(resolveStopLossPrice({ type: "fixed-distance", distance: 5 }, "BUY", 100, undefined), 95);
  assert.equal(resolveStopLossPrice({ type: "fixed-distance", distance: 5 }, "SELL", 100, undefined), 105);
});

test("resolveStopLossPrice: atr-multiple requires an ATR value", () => {
  assert.throws(() => resolveStopLossPrice({ type: "atr-multiple", atrMultiple: 2, atrPeriod: 14 }, "BUY", 100, undefined));
  assert.equal(resolveStopLossPrice({ type: "atr-multiple", atrMultiple: 2, atrPeriod: 14 }, "BUY", 100, 3), 94);
});

test("resolveStopLossPrice: undefined rule -> undefined", () => {
  assert.equal(resolveStopLossPrice(undefined, "BUY", 100, undefined), undefined);
});

test("resolveTakeProfitPrice: fixed-distance above entry for BUY", () => {
  assert.equal(resolveTakeProfitPrice({ type: "fixed-distance", distance: 10 }, "BUY", 100, undefined), 110);
});

test("resolveTakeProfitPrice: risk-multiple requires a stopLoss to compute the risk distance", () => {
  assert.throws(() => resolveTakeProfitPrice({ type: "risk-multiple", rMultiple: 2 }, "BUY", 100, undefined));
  assert.equal(resolveTakeProfitPrice({ type: "risk-multiple", rMultiple: 2 }, "BUY", 100, 95), 110); // risk=5, target=entry+2*5
});

test("resolvePositionSize: fixed-quantity/fixed-lot pass through directly", () => {
  assert.equal(resolvePositionSize({ method: "fixed-quantity", quantity: 3 }, { entryPrice: 100, equity: 10_000 }), 3);
  assert.equal(resolvePositionSize({ method: "fixed-lot", lots: 0.5 }, { entryPrice: 100, equity: 10_000 }), 0.5);
});

test("resolvePositionSize: percent-equity-risk divides risk amount by risk distance", () => {
  // 1% of 10,000 = 100; risk distance = |100-95| = 5 -> size = 20
  const size = resolvePositionSize({ method: "percent-equity-risk", percent: 1 }, { entryPrice: 100, stopLossPrice: 95, equity: 10_000 });
  assert.equal(size, 20);
});

test("resolvePositionSize: percent-equity-risk requires a stopLoss", () => {
  assert.throws(() => resolvePositionSize({ method: "percent-equity-risk", percent: 1 }, { entryPrice: 100, equity: 10_000 }));
});

test("resolvePositionSize: atr-based is an explicit, documented limitation, not a silent guess", () => {
  assert.throws(
    () => resolvePositionSize({ method: "atr-based", atrMultiple: 2, atrPeriod: 14 }, { entryPrice: 100, equity: 10_000 }),
    /no resolved quantity formula/,
  );
});
