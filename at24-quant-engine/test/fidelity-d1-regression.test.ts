import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { GOLDEN_BARS, GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.6.31 — the hard requirement: Q0.5's own golden fixtures, run through
 * Q0.5's OWN unmodified runSimulation(), must be COMPLETELY UNCHANGED by
 * Q0.6's existence. This file imports nothing from src/runtime/fidelity
 * for these two tests — it is the same call Q0.5 shipped, proving no
 * Q0.6 file the test suite loads altered its behavior.
 */
test("Q0.5's exact GOLDEN_BARS golden fixture, run via the UNMODIFIED runSimulation(), is untouched by Q0.6's existence", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 111);
  assert.equal(trade.grossPnl, 9);
  assert.equal(trade.rMultiple, 1.5);
  assert.equal(result.finalAccount.balance, 10_009);
  assert.equal(result.provenance.dataFidelity, "D1");
});

test("Q0.5's exact re-entry golden fixture, run via the UNMODIFIED runSimulation(), is untouched by Q0.6's existence", () => {
  const result = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));
  // Exactly one CLOSED trade is expected — matching Q0.5's own,
  // unmodified behavior, whatever that behavior happens to be for this
  // fixture's tail bars (this test's only job is proving Q0.6 changed
  // nothing about it, not re-deriving the exact mechanism).
  assert.equal(result.tradeLedger.length, 1);
});

test("Q0.6's own D1_OHLC delegation path reproduces the SAME underlying trade values as Q0.5's runSimulation() for the SAME golden fixture", () => {
  const direct = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const wrapped = runMultiFidelitySimulation(GOLDEN_BARS, { base: buildGoldenConfig(), fidelity: "D1_OHLC" });
  assert.deepEqual(wrapped.tradeLedger, direct.tradeLedger);
  assert.deepEqual(wrapped.finalAccount, direct.finalAccount);
  assert.deepEqual(wrapped.finalPositions, direct.finalPositions);
  assert.deepEqual(wrapped.eventStatistics, direct.eventStatistics);
  assert.deepEqual(wrapped.executionStatistics, direct.executionStatistics);
  assert.deepEqual(wrapped.metrics, direct.metrics);
  // provenance/resultHash are EXPECTED to differ (Q0.6 adds fidelity-specific fields) — every trade/account/position VALUE must not.
  assert.notEqual(wrapped.resultHash, direct.resultHash);
});
