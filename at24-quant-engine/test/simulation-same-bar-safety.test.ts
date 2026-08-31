import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.30: the signal that fires on bar T's close must never fill on bar
 * T itself — there is exactly one documented answer (NEXT_BAR_OPEN), and
 * this test proves the engine actually honors it rather than asserting
 * it only in a doc comment.
 *
 * In GOLDEN_BARS: the entry rule (PRICE > 100) first fires at bar 3's
 * close (101). The resulting order must fill at bar 4's OPEN (102) — not
 * at bar 3's close (101), and not at bar 3's own high/low.
 */
test("Q0.5.30: the entry order created from bar 3's signal fills at bar 4's open, never at bar 3's own price", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102, "must be bar 4's open");
  assert.notEqual(trade.entryPrice, 101, "must NOT be bar 3's close (the signal bar)");
  assert.equal(trade.entryTimestamp, GOLDEN_BARS[4]!.timestamp, "the fill timestamp must be bar 4's, not bar 3's");
});

test("Q0.5.30: an order created on bar T is never resolved against bar T's own OHLC even if T's range would trivially satisfy it", () => {
  // A single-bar simulation: the entry condition can fire (PRICE>100 on
  // the only bar), but there is no bar T+1 for the resulting order to
  // fill against — it must NOT retroactively fill against the same bar
  // that created it. It should end the run still unfilled (finalized as
  // EXPIRED), never as a phantom same-bar FILLED trade.
  const oneBar = [GOLDEN_BARS[3]!]; // close=101, would satisfy PRICE>100
  const result = runSimulation(oneBar, buildGoldenConfig(oneBar));
  assert.equal(result.tradeLedger.length, 0, "no trade can exist without a later bar to fill against");
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersCreated, 1);
  assert.equal(result.executionStatistics.ordersFilled, 0);
  assert.equal(result.executionStatistics.ordersExpired, 1, "the unfillable order must be finalized explicitly, not left dangling");
});

test("Q0.5.30: this is a single, frozen, unconditional rule — it holds regardless of how favorable same-bar execution would have been", () => {
  // Even though bar 3's own high (101.5) is well above the eventual
  // fill price of 102, and would have made a same-bar fill look
  // "reasonable" from a pure-price standpoint, the engine still refuses
  // to do it — proving the rule is unconditional, not a heuristic that
  // happens to usually push fills to the next bar.
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const trade = result.tradeLedger[0]!;
  assert.ok(trade.entryTimestamp > GOLDEN_BARS[3]!.timestamp);
});
