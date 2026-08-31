import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { canonicalizeStrategyIR } from "../src/runtime/strategy-ir/canonicalize.js";
import { ALL_GOLDEN_IR_FIXTURES } from "./fixtures/strategy-ir-fixtures.js";

/**
 * Q0.7.48 — source semantic fixture -> IR -> canonical IR -> same IR
 * hash, no semantic loss. Since Q0.7 builds no real parser, "source
 * semantic fixture" IS the hand-built StrategyIR itself (representing
 * what a future parser would produce) — the round trip under test here
 * is IR -> canonicalize -> hash -> canonicalize again -> hash again,
 * proving canonicalization is IDEMPOTENT and lossless.
 */
test("Q0.7.48: canonicalizing an already-canonical IR is idempotent (canonicalize(canonicalize(x)) === canonicalize(x))", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    const once = canonicalizeStrategyIR(ir);
    const twice = canonicalizeStrategyIR(once);
    assert.deepEqual(once, twice, `${ir.strategyId}: canonicalization must be idempotent`);
  }
});

test("Q0.7.48: hash(ir) === hash(canonicalize(ir)) for every golden fixture — canonicalization changes representation, never the semantic hash it feeds into", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    const direct = computeCanonicalIRHash(ir);
    const viaCanonical = computeCanonicalIRHash(canonicalizeStrategyIR(ir));
    assert.equal(direct, viaCanonical, `${ir.strategyId}: hashing an already-canonicalized IR must match hashing the raw IR`);
  }
});

test("Q0.7.48: a JSON round-trip (serialize/deserialize) of an IR produces the identical hash — no semantic loss across a serialization boundary", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    const roundTripped = JSON.parse(JSON.stringify(ir));
    assert.equal(computeCanonicalIRHash(ir), computeCanonicalIRHash(roundTripped), `${ir.strategyId}: JSON round-trip must not change the semantic hash`);
  }
});
