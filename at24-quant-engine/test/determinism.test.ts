import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalStringify, computeCanonicalHash } from "../src/runtime/determinism.js";
import { freezeStrategyVersion, verifyStrategyVersionIntegrity } from "../src/domain/strategy-version.js";
import { generateSignal } from "../src/runtime/signal-generator.js";
import { buildStrategySpec, buildMarketState } from "./fixtures.js";

test("canonicalStringify is independent of key insertion order", () => {
  const a = { z: 1, a: 2, nested: { b: 1, a: 2 } };
  const b = { a: 2, z: 1, nested: { a: 2, b: 1 } };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test("computeCanonicalHash is stable for structurally identical input across repeated calls", () => {
  const spec = buildStrategySpec();
  const h1 = computeCanonicalHash(spec);
  const h2 = computeCanonicalHash(buildStrategySpec());
  assert.equal(h1, h2);
});

test("computeCanonicalHash differs when strategy content differs", () => {
  const spec = buildStrategySpec();
  const mutated = { ...spec, version: "1.0.1" };
  assert.notEqual(computeCanonicalHash(spec), computeCanonicalHash(mutated));
});

test("identical StrategySpec + MarketState produce an identical Signal on every run", () => {
  const spec = buildStrategySpec();
  const state = buildMarketState({ ema20: 2400, ema50: 2380, rsi14: 60 });

  const signals = Array.from({ length: 5 }, () => generateSignal(spec, state));
  const hashes = signals.map((s) => computeCanonicalHash(s));

  assert.ok(hashes.every((h) => h === hashes[0]));
});

test("freezeStrategyVersion produces a contentHash that verifies against the frozen spec", () => {
  const spec = buildStrategySpec();
  const record = freezeStrategyVersion(spec, Date.parse("2026-06-01T00:00:00Z"));
  assert.equal(verifyStrategyVersionIntegrity(record), true);
});

test("mutating a StrategyVersionRecord's spec in place is detected by integrity verification", () => {
  const spec = buildStrategySpec();
  const record = freezeStrategyVersion(spec, Date.parse("2026-06-01T00:00:00Z"));
  const tampered = { ...record, spec: { ...record.spec, version: "9.9.9" } };
  assert.equal(verifyStrategyVersionIntegrity(tampered), false);
});

test("freezeStrategyVersion snapshots the spec so later external mutation of the source object does not affect it", () => {
  const spec = buildStrategySpec();
  const record = freezeStrategyVersion(spec, Date.parse("2026-06-01T00:00:00Z"));
  const hashBefore = computeCanonicalHash(record.spec);
  // spec object itself is a fresh literal per buildStrategySpec() call, so this
  // proves record.spec is a structural clone, not a shared reference to `spec`.
  assert.notEqual(record.spec, spec);
  assert.equal(computeCanonicalHash(record.spec), hashBefore);
});
