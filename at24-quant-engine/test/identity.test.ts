import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSemanticStrategyHash, computeStrategyIdentityHash, computeExperimentIdentityHash } from "../src/runtime/identity.js";
import { buildStrategySpec, XAUUSD, H1 } from "./fixtures.js";

test("computeSemanticStrategyHash ignores metadata.createdAt", () => {
  const spec = buildStrategySpec();
  const laterSpec = { ...spec, metadata: { ...spec.metadata, createdAt: spec.metadata.createdAt + 1_000_000 } };
  assert.equal(computeSemanticStrategyHash(spec), computeSemanticStrategyHash(laterSpec));
});

test("computeSemanticStrategyHash changes when entry rules change", () => {
  const spec = buildStrategySpec();
  const mutated = { ...spec, entryRules: [{ ...spec.entryRules[0]!, id: "different-id" }] };
  assert.notEqual(computeSemanticStrategyHash(spec), computeSemanticStrategyHash(mutated));
});

test("computeSemanticStrategyHash is DIFFERENT from StrategyVersionRecord's full contentHash (metadata-sensitive vs not)", async () => {
  const { freezeStrategyVersion } = await import("../src/domain/strategy-version.js");
  const spec = buildStrategySpec();
  const record = freezeStrategyVersion(spec, Date.now());
  assert.notEqual(computeSemanticStrategyHash(spec), record.contentHash);
});

test("computeStrategyIdentityHash: same semantic configuration + same indicator versions -> same hash", () => {
  const spec = buildStrategySpec();
  const pins = { EMA: "1.0.0", RSI: "1.0.0" };
  assert.equal(computeStrategyIdentityHash(spec, pins), computeStrategyIdentityHash(buildStrategySpec(), pins));
});

test("computeStrategyIdentityHash: an indicator version change alone produces a different hash", () => {
  const spec = buildStrategySpec();
  const hashV1 = computeStrategyIdentityHash(spec, { EMA: "1.0.0" });
  const hashV2 = computeStrategyIdentityHash(spec, { EMA: "1.1.0" });
  assert.notEqual(hashV1, hashV2);
});

test("computeStrategyIdentityHash: a metadata-only change does not affect identity", () => {
  const spec = buildStrategySpec();
  const redescribed = { ...spec, metadata: { ...spec.metadata, description: "a totally different description" } };
  assert.equal(computeStrategyIdentityHash(spec, {}), computeStrategyIdentityHash(redescribed, {}));
});

function baseExperimentInput() {
  return {
    strategyHash: "abc123",
    datasetId: "fixture-dataset",
    datasetVersion: "v1",
    instrument: XAUUSD,
    timeframe: H1,
    startTime: 1000,
    endTime: 2000,
    parameters: { rsiThreshold: 55 },
    executionAssumptions: { fillModel: "next-bar-open" as const, costsExplicitlyZero: true as const },
    validationMethod: "single-pass" as const,
    runtimeVersion: "0.1.0",
  };
}

test("computeExperimentIdentityHash: identical configuration -> identical hash", () => {
  assert.equal(computeExperimentIdentityHash(baseExperimentInput()), computeExperimentIdentityHash(baseExperimentInput()));
});

test("computeExperimentIdentityHash: a parameter change produces a different identity", () => {
  const a = computeExperimentIdentityHash(baseExperimentInput());
  const b = computeExperimentIdentityHash({ ...baseExperimentInput(), parameters: { rsiThreshold: 60 } });
  assert.notEqual(a, b);
});

test("computeExperimentIdentityHash: a dataset change produces a different identity", () => {
  const a = computeExperimentIdentityHash(baseExperimentInput());
  const b = computeExperimentIdentityHash({ ...baseExperimentInput(), datasetVersion: "v2" });
  assert.notEqual(a, b);
});

test("computeExperimentIdentityHash: an execution-assumption change produces a different identity", () => {
  const a = computeExperimentIdentityHash(baseExperimentInput());
  const b = computeExperimentIdentityHash({
    ...baseExperimentInput(),
    executionAssumptions: { fillModel: "intrabar-touch", costsExplicitlyZero: true },
  });
  assert.notEqual(a, b);
});

test("computeExperimentIdentityHash: a strategyHash change (representing a strategy version change) produces a different identity", () => {
  const a = computeExperimentIdentityHash(baseExperimentInput());
  const b = computeExperimentIdentityHash({ ...baseExperimentInput(), strategyHash: "def456" });
  assert.notEqual(a, b);
});
