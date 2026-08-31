import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";

const STOP_LIMIT_BARS = [bar(0, 100, 101, 99, 101), bar(1, 102, 104, 101.5, 103), bar(2, 103, 105, 102, 104)];

// --- Q0.11.32: determinism — 3 identical runs produce byte-identical orders/fills/positions/ledger/hash ---
test("Q0.11.32: three runs of the same LIMIT-order-bearing simulation are byte-identical", () => {
  const config = buildOrderTypeConfig(STOP_LIMIT_BARS, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) });
  const results = [1, 2, 3].map(() => runSimulation(STOP_LIMIT_BARS, config));
  assert.equal(results[0]!.resultHash, results[1]!.resultHash);
  assert.equal(results[1]!.resultHash, results[2]!.resultHash);
  assert.deepEqual(results[0]!.finalPositions, results[1]!.finalPositions);
  assert.deepEqual(results[0]!.eventStatistics, results[1]!.eventStatistics);
});

test("Q0.11.32: replaying the same bars/config reproduces an identical SimulationResult", () => {
  const config = buildOrderTypeConfig(STOP_LIMIT_BARS, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) });
  const first = runSimulation(STOP_LIMIT_BARS, config);
  const replay = runSimulation(STOP_LIMIT_BARS, config);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(replay)));
});

// --- Q0.11.40: provenance — order semantics are part of result identity ---
test("Q0.11.40: changing ONLY the executionType (MARKET vs LIMIT, same eventual entry price) changes resultHash", () => {
  const marketBars = [bar(0, 100, 101, 99, 101), bar(1, 99, 99.5, 98, 99)];
  const limitBars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)]; // limit(99) touched via strict trade-through, same eventual entryPrice as MARKET's open
  const marketResult = runSimulation(marketBars, buildOrderTypeConfig(marketBars, "BUY", "MARKET"));
  const limitResult = runSimulation(limitBars, buildOrderTypeConfig(limitBars, "BUY", "LIMIT", { limitPrice: absolute(99) }));
  assert.notEqual(marketResult.resultHash, limitResult.resultHash, "the SAME numeric entry price via a different order TYPE must still be a different result identity");
});

test("Q0.11.40: changing the limit price (with everything else held constant) changes resultHash even when the order never fills", () => {
  const bars = [bar(0, 105, 106, 104, 105), bar(1, 105, 106, 104, 105)];
  const resultA = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(90) }));
  const resultB = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(80) }));
  assert.notEqual(resultA.resultHash, resultB.resultHash, "the declared price is part of provenance/identity even on a run where neither order ever fills");
});

test("Q0.11.40: result provenance identifies the fidelity/execution model used, unaffected by order type", () => {
  const result = runSimulation(STOP_LIMIT_BARS, buildOrderTypeConfig(STOP_LIMIT_BARS, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) }));
  assert.equal(result.provenance.dataFidelity, "D1");
  assert.ok(result.provenance.executionModel);
  assert.ok(result.provenance.strategyHash, "the strategy hash (which now incorporates executionType/limitPrice/stopPrice via the EntryRule) must be present in provenance");
});
