import { test } from "node:test";
import assert from "node:assert/strict";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { compareFidelities } from "../src/runtime/fidelity/fidelity-comparison-engine.js";
import { FIXTURE_A_PARENT_BARS, buildFixtureAD1Config, buildFixtureAD2Config } from "./fixtures/fidelity-fixtures.js";

test("compareFidelities: two runs with identical resultHashes are reported IDENTICAL with no deltas", () => {
  const config = buildFixtureAD2Config();
  const a = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const b = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  const comparison = compareFidelities(a, b);
  assert.equal(comparison.identical, true);
  assert.equal(comparison.differenceClassification, "IDENTICAL");
  assert.equal(comparison.netPnlDelta, 0);
});

test("compareFidelities (Fixture A, D1 vs D2): classified as PRICE_AND_TIMING — same trade count, but both exit price and exit timestamp differ", () => {
  const d1 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  const comparison = compareFidelities(d1, d2);

  assert.equal(comparison.identical, false);
  assert.equal(comparison.baselineTradeCount, 1);
  assert.equal(comparison.comparedTradeCount, 1);
  assert.equal(comparison.differenceClassification, "PRICE_AND_TIMING");
  assert.equal(comparison.matchedTrades.length, 1);
  assert.equal(comparison.matchedTrades[0]!.priceDelta, 111 - 96); // D2's exit (111) minus D1's exit (96)
  assert.equal(comparison.netPnlDelta, 9 - -6); // D2's grossPnl (+9) minus D1's grossPnl (-6), fees are zero in this fixture
  assert.equal(comparison.baselineFidelity, "D1_OHLC");
  assert.equal(comparison.comparedFidelity, "D2_LOWER_TIMEFRAME");
});

test("compareFidelities: a STRUCTURAL classification is reported when the trade COUNT itself differs between two results", () => {
  const baseline = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const truncated = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS.slice(0, 4), buildFixtureAD1Config());
  const comparison = compareFidelities(baseline, truncated);
  assert.equal(comparison.differenceClassification, "STRUCTURAL");
  assert.equal(comparison.baselineTradeCount, 1);
  assert.equal(comparison.comparedTradeCount, 0);
  assert.equal(comparison.unmatchedBaselineTradeIds.length, 1);
});
