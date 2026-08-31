import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMarketFill, resolveLimitFill, resolveStopFill, resolveStopLimitFill } from "../src/runtime/simulation/bar-fill-model.js";
import { createOrder } from "../src/runtime/simulation/order-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import type { Instrument, OHLCVBar } from "../src/domain/market-data.js";

/**
 * Q0.5.31: golden gap scenarios for every order type, both directions.
 * "Gap-up" = the bar's open is materially above the prior context's
 * price level; "gap-down" = materially below. Each case states the
 * expected fill price and WHY, per the rules already specified in
 * bar-fill-model.ts.
 */

const INSTRUMENT: Instrument = { symbol: "X" };
function bar(overrides: Partial<OHLCVBar>): OHLCVBar {
  return { timestamp: 1, instrument: INSTRUMENT, timeframe: "H1", open: 100, high: 100, low: 100, close: 100, volume: 1000, ...overrides };
}
function order(overrides: Partial<Parameters<typeof createOrder>[0]>) {
  return createOrder({ strategyVersion: "1.0.0", instrument: INSTRUMENT, quantity: 1, creationTimestamp: 0, side: "BUY", orderType: "MARKET", ...overrides }, 0);
}

// ---- MARKET: gaps are simply the fill price, no special case ----
test("GAP-UP + MARKET BUY: fills at the gapped-up open (no ceiling)", () => {
  const outcome = resolveMarketFill(order({ side: "BUY" }), bar({ open: 150 }), ZeroSpread, ZeroSlippage);
  assert.equal(outcome.fillPrice, 150);
});

test("GAP-DOWN + MARKET SELL: fills at the gapped-down open (no floor)", () => {
  const outcome = resolveMarketFill(order({ side: "SELL" }), bar({ open: 50 }), ZeroSpread, ZeroSlippage);
  assert.equal(outcome.fillPrice, 50);
});

// ---- LIMIT: a favorable gap (better than the limit) fills at the open ----
test("GAP-DOWN + LIMIT BUY (limit=100): open gaps below the limit -> fills at the open (better than requested)", () => {
  const outcome = resolveLimitFill(order({ side: "BUY", orderType: "LIMIT", limitPrice: 100 }), bar({ open: 80, low: 78, high: 82 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 80, "favorable gap fills at the better open price, not the limit");
});

test("GAP-UP + LIMIT SELL (limit=100): open gaps above the limit -> fills at the open (better than requested)", () => {
  const outcome = resolveLimitFill(order({ side: "SELL", orderType: "LIMIT", limitPrice: 100 }), bar({ open: 120, low: 118, high: 122 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 120);
});

test("GAP-UP + LIMIT BUY (limit=100): open gaps AWAY from the limit -> not filled this bar", () => {
  const outcome = resolveLimitFill(order({ side: "BUY", orderType: "LIMIT", limitPrice: 100 }), bar({ open: 120, low: 118, high: 122 }));
  assert.equal(outcome.filled, false, "a BUY limit gapping upward moves away from the order, not through it");
});

// ---- STOP: an unfavorable gap (through the stop) fills at the WORSE open, never the nominal stop ----
test("GAP-UP + STOP BUY (stop=100): open gaps above the stop -> fills at the WORSE open, not at 100", () => {
  const outcome = resolveStopFill(order({ side: "BUY", orderType: "STOP", stopPrice: 100 }), bar({ open: 120, high: 125, low: 119 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 120, "must never report the nominal stop price when the market actually gapped past it");
});

test("GAP-DOWN + STOP SELL (stop=100): open gaps below the stop -> fills at the WORSE open, not at 100", () => {
  const outcome = resolveStopFill(order({ side: "SELL", orderType: "STOP", stopPrice: 100 }), bar({ open: 80, high: 81, low: 75 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 80);
});

test("GAP-DOWN + STOP BUY (stop=100): a gap AWAY from a BUY stop does not spuriously trigger it", () => {
  const outcome = resolveStopFill(order({ side: "BUY", orderType: "STOP", stopPrice: 100 }), bar({ open: 80, high: 90, low: 75 }));
  assert.equal(outcome.filled, false);
});

// ---- STOP_LIMIT: only an UNAMBIGUOUS gap (open past stop AND within limit) fills; anything else is conservative ----
test("GAP-UP + STOP_LIMIT BUY (stop=100, limit=110): open lands past the stop but still within the limit -> unambiguous, fills at open", () => {
  const outcome = resolveStopLimitFill(order({ side: "BUY", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 110 }), bar({ open: 105, high: 112, low: 104 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 105);
});

test("GAP-UP + STOP_LIMIT BUY (stop=100, limit=105): open gaps past BOTH the stop and the limit -> conservative, no manufactured fill", () => {
  const outcome = resolveStopLimitFill(order({ side: "BUY", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 105 }), bar({ open: 120, high: 122, low: 119 }));
  assert.equal(outcome.filled, false, "the gap blew through the limit too — filling at 120 would be worse than the limit ever allowed, so it must not fill");
  assert.equal(outcome.triggeredOnly, true);
});

test("GAP-DOWN + STOP_LIMIT SELL (stop=100, limit=90): open lands past the stop but still within the limit -> unambiguous, fills at open", () => {
  const outcome = resolveStopLimitFill(order({ side: "SELL", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 90 }), bar({ open: 95, high: 96, low: 88 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 95);
});

test("GAP-DOWN + STOP_LIMIT SELL (stop=100, limit=95): open gaps past BOTH stop and limit -> conservative, no manufactured fill", () => {
  const outcome = resolveStopLimitFill(order({ side: "SELL", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 95 }), bar({ open: 80, high: 82, low: 78 }));
  assert.equal(outcome.filled, false);
  assert.equal(outcome.triggeredOnly, true);
});
