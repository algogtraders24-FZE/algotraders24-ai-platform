import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, buildQ15Config, signalExitRule } from "./fixtures/q15-pyramiding-exit-fixtures.js";

/**
 * Q1.5.9 — repeats Q1.4's own determinism/immutability guarantees for the
 * two new Q1.5 execution paths (pyramiding admission, SIGNAL_EXIT). No new
 * nondeterministic primitive (Date.now/Math.random/new Date/
 * crypto.randomUUID/process.env) was introduced anywhere in the Q1.5
 * diff — grep-verifiable directly against the changed files.
 */

const PYRAMID_BARS = [bar(0, 101, 101, 101, 101), bar(1, 102, 102, 102, 102), bar(2, 103, 103, 103, 103), bar(3, 99, 99, 99, 99)];
const PYRAMID_OPTS = {
  direction: "BUY" as const,
  exitRules: [signalExitRule("BUY", 100)],
  pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE" as const, oppositeDirectionBehavior: "REVERSAL" as const },
};

test("Q1.5.9: pyramiding + SIGNAL_EXIT — 3 independent runs of the SAME input produce a byte-identical resultHash", () => {
  const r1 = runSimulation(PYRAMID_BARS, buildQ15Config(PYRAMID_BARS, PYRAMID_OPTS));
  const r2 = runSimulation(PYRAMID_BARS, buildQ15Config(PYRAMID_BARS, PYRAMID_OPTS));
  const r3 = runSimulation(PYRAMID_BARS, buildQ15Config(PYRAMID_BARS, PYRAMID_OPTS));
  assert.equal(r1.resultHash, r2.resultHash);
  assert.equal(r2.resultHash, r3.resultHash);
  assert.deepEqual(r1.tradeLedger, r2.tradeLedger);
  assert.deepEqual(r1.tradeLedger, r3.tradeLedger);
});

test("Q1.5.9: pyramiding + SIGNAL_EXIT — a JSON round-trip of the config's bars/strategySpec (including the new pyramiding/exitRules fields) produces an identical result", () => {
  const config = buildQ15Config(PYRAMID_BARS, PYRAMID_OPTS);
  const barsRoundTripped = JSON.parse(JSON.stringify(PYRAMID_BARS));
  // indicatorSeries is a Map (pre-existing SimulationConfig shape, unrelated to Q1.5) — JSON has no
  // native Map representation, so it is round-tripped via entries, exactly like any Map-typed field.
  const specRoundTripped = JSON.parse(JSON.stringify(config.strategySpec)) as typeof config.strategySpec;
  const seriesEntries = JSON.parse(JSON.stringify([...config.indicatorSeries])) as (readonly [string, readonly (number | boolean | undefined)[]])[];
  const configRoundTripped = { ...config, strategySpec: specRoundTripped, indicatorSeries: new Map(seriesEntries) };
  const original = runSimulation(PYRAMID_BARS, config);
  const roundTripped = runSimulation(barsRoundTripped, configRoundTripped);
  assert.equal(original.resultHash, roundTripped.resultHash);
});

test("Q1.5.9: runSimulation never mutates its input bars or strategySpec.pyramiding/exitRules (Q0.5.18/38's immutability guarantee, preserved)", () => {
  const bars = PYRAMID_BARS.map((b) => ({ ...b }));
  const config = buildQ15Config(bars, PYRAMID_OPTS);
  const barsSnapshot = JSON.parse(JSON.stringify(bars));
  const specSnapshot = JSON.parse(JSON.stringify(config.strategySpec));
  runSimulation(bars, config);
  assert.deepEqual(bars, barsSnapshot, "input bars must never be mutated");
  assert.deepEqual(config.strategySpec, specSnapshot, "strategySpec (including the new pyramiding/exitRules fields) must never be mutated");
});
