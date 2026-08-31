import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMarketFill,
  resolveLimitFill,
  resolveStopFill,
  resolveStopLimitFill,
  resolveProtectiveExit,
} from "../src/runtime/simulation/bar-fill-model.js";
import { createOrder } from "../src/runtime/simulation/order-engine.js";
import { ZeroSpread, createFixedSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import type { Instrument, OHLCVBar } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "X" };
function bar(overrides: Partial<OHLCVBar>): OHLCVBar {
  return { timestamp: 1, instrument: INSTRUMENT, timeframe: "H1", open: 100, high: 102, low: 98, close: 100, volume: 1000, ...overrides };
}

function order(overrides: Partial<Parameters<typeof createOrder>[0]>) {
  return createOrder({ strategyVersion: "1.0.0", instrument: INSTRUMENT, quantity: 1, creationTimestamp: 0, side: "BUY", orderType: "MARKET", ...overrides }, 0);
}

// ---- MARKET ----
test("MARKET fill: BUY fills at bar open with ZeroSpread/ZeroSlippage", () => {
  const o = order({ side: "BUY", orderType: "MARKET" });
  const outcome = resolveMarketFill(o, bar({ open: 105 }), ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 105);
});

test("MARKET fill: FixedSpread widens the fill against the trader on both sides", () => {
  const spread = createFixedSpread(2); // half-spread = 1
  const buy = resolveMarketFill(order({ side: "BUY", orderType: "MARKET" }), bar({ open: 100 }), spread, ZeroSlippage);
  const sell = resolveMarketFill(order({ side: "SELL", orderType: "MARKET" }), bar({ open: 100 }), spread, ZeroSlippage);
  assert.equal(buy.fillPrice, 101);
  assert.equal(sell.fillPrice, 99);
});

test("MARKET fill: accepts whatever the actual open is, gap or not (no special gap case)", () => {
  const outcome = resolveMarketFill(order({ side: "BUY", orderType: "MARKET" }), bar({ open: 150 }), ZeroSpread, ZeroSlippage);
  assert.equal(outcome.fillPrice, 150);
});

// ---- LIMIT ----
test("LIMIT BUY: strict trade-through required (low < limit), touch alone does not fill", () => {
  const o = order({ side: "BUY", orderType: "LIMIT", limitPrice: 100 });
  assert.equal(resolveLimitFill(o, bar({ open: 101, low: 100 })).filled, false, "mere touch must not fill");
  assert.equal(resolveLimitFill(o, bar({ open: 101, low: 99.99 })).filled, true, "strictly below the limit fills");
});

test("LIMIT BUY: favorable gap fills at the open, better than the limit", () => {
  const o = order({ side: "BUY", orderType: "LIMIT", limitPrice: 100 });
  const outcome = resolveLimitFill(o, bar({ open: 95, low: 94, high: 96 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 95);
});

test("LIMIT SELL: strict trade-through required (high > limit)", () => {
  const o = order({ side: "SELL", orderType: "LIMIT", limitPrice: 100 });
  assert.equal(resolveLimitFill(o, bar({ open: 99, high: 100 })).filled, false, "mere touch must not fill");
  assert.equal(resolveLimitFill(o, bar({ open: 99, high: 100.01 })).filled, true);
});

test("LIMIT: no trade through at all -> not filled", () => {
  const o = order({ side: "BUY", orderType: "LIMIT", limitPrice: 50 });
  assert.equal(resolveLimitFill(o, bar({ low: 90, high: 110 })).filled, false);
});

// ---- STOP ----
test("STOP BUY: triggers at the stop price when high reaches it, no gap", () => {
  const o = order({ side: "BUY", orderType: "STOP", stopPrice: 105 });
  const outcome = resolveStopFill(o, bar({ open: 100, high: 105, low: 99 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 105);
});

test("STOP BUY: gap-through fills at the WORSE open price, never at the stop level", () => {
  const o = order({ side: "BUY", orderType: "STOP", stopPrice: 105 });
  const outcome = resolveStopFill(o, bar({ open: 110, high: 112, low: 109 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 110, "must fill at the gapped-through open, not the nominal stop price");
});

test("STOP SELL: mirrors BUY (low <= stop triggers, gap-through fills at open)", () => {
  const o = order({ side: "SELL", orderType: "STOP", stopPrice: 95 });
  assert.equal(resolveStopFill(o, bar({ low: 95 })).fillPrice, 95);
  const gapped = resolveStopFill(o, bar({ open: 90, low: 88, high: 91 }));
  assert.equal(gapped.fillPrice, 90);
});

test("STOP: not triggered when the level is never reached", () => {
  const o = order({ side: "BUY", orderType: "STOP", stopPrice: 200 });
  assert.equal(resolveStopFill(o, bar({ high: 105 })).filled, false);
});

// ---- STOP_LIMIT ----
test("STOP_LIMIT BUY: unambiguous gap (open past stop AND within limit) fills immediately at open", () => {
  const o = order({ side: "BUY", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 105 });
  const outcome = resolveStopLimitFill(o, bar({ open: 102, high: 106, low: 101 }));
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 102);
});

test("STOP_LIMIT BUY: intrabar trigger without open-proof is CONSERVATIVE — triggeredOnly, never a manufactured fill", () => {
  const o = order({ side: "BUY", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 102 });
  const outcome = resolveStopLimitFill(o, bar({ open: 98, high: 103, low: 97 }));
  assert.equal(outcome.filled, false);
  assert.equal(outcome.triggeredOnly, true);
});

test("STOP_LIMIT: not triggered at all when the stop level is never reached", () => {
  const o = order({ side: "BUY", orderType: "STOP_LIMIT", stopPrice: 200, limitPrice: 205 });
  const outcome = resolveStopLimitFill(o, bar({ high: 105 }));
  assert.equal(outcome.filled, false);
  assert.equal(outcome.triggeredOnly, undefined);
});

test("STOP_LIMIT SELL mirrors BUY", () => {
  const o = order({ side: "SELL", orderType: "STOP_LIMIT", stopPrice: 100, limitPrice: 95 });
  const gap = resolveStopLimitFill(o, bar({ open: 97, low: 94, high: 98 }));
  assert.equal(gap.filled, true);
  assert.equal(gap.fillPrice, 97);
});

// ---- Protective exit (Q0.5.32 golden scenarios) ----
test("1. TP only reachable -> clean take-profit exit", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ low: 99, high: 111 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 110);
  assert.equal(outcome.ambiguous, undefined);
});

test("2. SL only reachable -> clean stop-loss exit", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ low: 89, high: 100 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 90);
  assert.equal(outcome.ambiguous, undefined);
});

test("3. Both reachable -> CONSERVATIVE resolves to the stop-loss, flagged ambiguous", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ low: 89, high: 111 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 90, "must resolve to the worse (SL) outcome, never the favorable TP");
  assert.equal(outcome.ambiguous, true);
});

test("4. Neither reachable -> no exit", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ low: 95, high: 105 }));
  assert.equal(outcome.exited, false);
});

test("5. Gap through TP -> fills at the open (better for the trader, but real), not the nominal TP", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ open: 115, low: 114, high: 118 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 115);
});

test("6. Gap through SL -> fills at the open (worse for the trader), not the nominal SL", () => {
  const outcome = resolveProtectiveExit("BUY", 90, 110, bar({ open: 85, low: 82, high: 86 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 85);
});

test("7. Same-bar ambiguity for SELL positions mirrors BUY", () => {
  const outcome = resolveProtectiveExit("SELL", 110, 90, bar({ low: 89, high: 111 }));
  assert.equal(outcome.exited, true);
  assert.equal(outcome.ambiguous, true);
  assert.equal(outcome.exitPrice, 110, "SELL's stop-loss is the higher level — conservative still resolves to the SL");
});

test("8. Conservative resolution never varies across repeated evaluation of the identical ambiguous bar", () => {
  const run = () => resolveProtectiveExit("BUY", 90, 110, bar({ low: 89, high: 111 }));
  assert.deepEqual(run(), run());
});

test("no protective levels set -> never exits", () => {
  assert.equal(resolveProtectiveExit("BUY", undefined, undefined, bar({ low: 0, high: 1000 })).exited, false);
});
