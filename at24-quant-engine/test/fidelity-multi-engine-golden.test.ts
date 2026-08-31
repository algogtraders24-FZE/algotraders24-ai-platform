import { test } from "node:test";
import assert from "node:assert/strict";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { FIXTURE_A_PARENT_BARS, FIXTURE_A_CHILD_BARS, buildFixtureAD1Config, buildFixtureAD2Config } from "./fixtures/fidelity-fixtures.js";

test("Fixture A / D1_OHLC: the ambiguous same-bar SL/TP case conservatively resolves to the STOP-LOSS (matches Q0.5's own documented conservative policy)", () => {
  const result = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 96); // stop-loss, conservative
  assert.equal(trade.grossPnl, -6);
  assert.equal(result.provenance.simulationFidelity, "D1_OHLC");
});

test("Fixture A / D2_LOWER_TIMEFRAME: the SAME bars/strategy, given real M15 children, resolve the SAME event cleanly to the TAKE-PROFIT — proving D2 is strictly more precise, never contradicting D1's conservative fallback", () => {
  const result = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 111); // take-profit, proven by child 0 alone
  assert.equal(trade.grossPnl, 9);
  assert.equal(result.provenance.simulationFidelity, "D2_LOWER_TIMEFRAME");
});

test("Fixture A: the MARKET order fills against child 0 (the FIRST eligible child of parent bar 4, mirroring D1's 'fills at the bar's open') and the protective exit resolves in the SAME child-bar iteration (Q0.6.21/22 same-bar entry+exit) — both well before the parent bar's own close", () => {
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  const trade = d2.tradeLedger[0]!;
  const parentBar4 = FIXTURE_A_PARENT_BARS[4]!;
  const child0Timestamp = FIXTURE_A_CHILD_BARS[0]!.timestamp;
  assert.equal(trade.entryTimestamp, child0Timestamp);
  assert.equal(trade.exitTimestamp, child0Timestamp);
  assert.ok(trade.exitTimestamp < parentBar4.timestamp, "the exit must be recorded at an EARLIER, intrabar timestamp than the parent bar's own close");
  assert.ok(trade.exitTimestamp > parentBar4.timestamp - 3_600_000, "the exit timestamp must still fall within this same parent bar's window");
});

test("Fixture A: resultHash differs between D1_OHLC and D2_LOWER_TIMEFRAME even though every input bar/strategy/config is otherwise identical (Q0.6.30)", () => {
  const d1 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  assert.notEqual(d1.resultHash, d2.resultHash);
});

test("Fixture A / D2: FidelityQuality correctly reports 1 COMPLETE parent (bar 4) and 4 parents resolved at parent granularity (bars 0-3, no child data, FALLBACK_TO_D1)", () => {
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  const quality = d2.provenance.fidelityQuality;
  assert.equal(quality.detailCoverage.totalParents, 5);
  assert.equal(quality.detailCoverage.completeParents, 1);
  assert.equal(quality.detailCoverage.missingParents, 4);
  assert.equal(quality.parentsResolvedAtParentGranularity, 4);
  assert.equal(quality.ambiguousResolutionCount, 0); // D2 resolved cleanly, no lingering ambiguity
});

test("Fixture A / D1 via multi-fidelity delegation: underlying values are byte-identical to calling Q0.5's runSimulation() directly (D1 regression proof, see fidelity-d1-regression.test.ts for the full Q0.5 golden-fixture version)", async () => {
  const { runSimulation } = await import("../src/runtime/simulation/simulation-engine.js");
  const config = buildFixtureAD1Config();
  const direct = runSimulation(FIXTURE_A_PARENT_BARS, config.base);
  const viaWrapper = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
  assert.deepEqual(viaWrapper.tradeLedger, direct.tradeLedger);
  assert.deepEqual(viaWrapper.finalAccount, direct.finalAccount);
  assert.deepEqual(viaWrapper.finalPositions, direct.finalPositions);
});

test("missingDetailPolicy defaults to FAIL: a D2 run with NO detailProvider configured throws rather than silently resolving at parent granularity", () => {
  const config = buildFixtureAD2Config();
  const strictConfig = { ...config, missingDetailPolicy: "FAIL" as const };
  assert.throws(() => runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, strictConfig), /INSUFFICIENT_DETAIL_DATA/);
});
