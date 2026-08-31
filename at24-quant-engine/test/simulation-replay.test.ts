import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.37: record the event stream (here, the input bar sequence — the
 * queue's own deterministic seeding is a pure function of it), replay it
 * through a second, fully independent runSimulation() call, and confirm
 * the final state matches exactly.
 */
test("Q0.5.37: replaying the identical recorded bar stream reproduces the identical final state", () => {
  const recordedBars = [...GOLDEN_BARS];

  const original = runSimulation(recordedBars, buildGoldenConfig(recordedBars));
  const replayed = runSimulation(recordedBars, buildGoldenConfig(recordedBars));

  assert.deepEqual(replayed.finalAccount, original.finalAccount);
  assert.deepEqual(replayed.finalPositions, original.finalPositions);
  assert.deepEqual(replayed.tradeLedger, original.tradeLedger);
  assert.deepEqual(replayed.metrics, original.metrics);
  assert.equal(replayed.resultHash, original.resultHash);
});

test("Q0.5.37: replay from a serialized (JSON round-tripped) bar stream still reproduces the identical result", () => {
  const serialized = JSON.stringify(GOLDEN_BARS);
  const deserializedBars = JSON.parse(serialized);

  const original = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const replayed = runSimulation(deserializedBars, buildGoldenConfig(deserializedBars));

  assert.equal(replayed.resultHash, original.resultHash);
});
