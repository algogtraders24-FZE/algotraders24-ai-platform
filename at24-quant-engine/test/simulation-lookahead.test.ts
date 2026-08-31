import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { TimeFrontier } from "../src/runtime/time-frontier.js";
import { GOLDEN_BARS, GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig, SIM_INSTRUMENT, SIM_TIMEFRAME } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.39: appending future bars must never change already-produced
 * historical results. Tested two ways: (1) directly, by comparing a
 * truncated simulation's trade ledger against the same-length PREFIX of
 * a longer simulation's ledger; (2) against the existing TimeFrontier
 * primitive (Q0.2), proving bars sliced via the frontier at a given
 * cursor produce the identical simulation outcome as a plain array slice
 * to that same point.
 */
test("Q0.5.39: a trade that closed within the first N bars is identical whether or not bars N+1.. exist", () => {
  const shortRun = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const longRun = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));

  // The first trade (closed within GOLDEN_BARS' window) must be byte-identical
  // in both runs, even though longRun saw two additional future bars.
  assert.deepEqual(longRun.tradeLedger[0], shortRun.tradeLedger[0]);
});

test("Q0.5.39: the account balance/realizedPnl at the point the first trade closes is unaffected by future bars", () => {
  const shortRun = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const longRun = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));
  // shortRun's final state IS the state right after the first trade closes
  // (no further bars exist to move it) — longRun's realizedPnl at that
  // same point (before its second trade's unrealized P&L accrues) must
  // match exactly, since realizedPnl only changes on a closed trade.
  assert.equal(longRun.finalAccount.realizedPnl, shortRun.finalAccount.realizedPnl);
});

test("Q0.5.39 (TimeFrontier): bars sliced via TimeFrontier at a cursor produce the identical simulation outcome as a plain array slice to that same point", () => {
  const series = { instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, bars: GOLDEN_BARS };
  const frontier = new TimeFrontier(series);
  frontier.advanceTo(GOLDEN_BARS[GOLDEN_BARS.length - 1]!.timestamp);

  const viaFrontier = runSimulation(frontier.availableBars(), buildGoldenConfig(frontier.availableBars()));
  const viaDirectSlice = runSimulation(GOLDEN_BARS, buildGoldenConfig(GOLDEN_BARS));

  assert.equal(viaFrontier.resultHash, viaDirectSlice.resultHash);
});

test("Q0.5.39: a mid-run cursor via TimeFrontier reproduces exactly the same partial-run result as a manual slice", () => {
  const series = { instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, bars: GOLDEN_BARS };
  const frontier = new TimeFrontier(series);
  frontier.advanceTo(GOLDEN_BARS[2]!.timestamp);

  const viaFrontier = runSimulation(frontier.availableBars(), buildGoldenConfig(frontier.availableBars()));
  const viaDirectSlice = runSimulation(GOLDEN_BARS.slice(0, 3), buildGoldenConfig(GOLDEN_BARS.slice(0, 3)));

  assert.equal(viaFrontier.resultHash, viaDirectSlice.resultHash);
});
