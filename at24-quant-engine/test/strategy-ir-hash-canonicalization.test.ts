import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { canonicalizeExpression } from "../src/runtime/strategy-ir/canonicalize.js";
import { and, comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import { indicator } from "../src/domain/indicator-reference.js";
import { fixtureSimpleSMA } from "./fixtures/strategy-ir-fixtures.js";

test("Q0.7.34: computeCanonicalIRHash is unaffected by strategyId", () => {
  const a = fixtureSimpleSMA();
  const b = { ...a, strategyId: "a-totally-different-id" };
  assert.equal(computeCanonicalIRHash(a), computeCanonicalIRHash(b));
});

test("Q0.7.34: computeCanonicalIRHash is unaffected by metadata.createdAt / description / author / tags", () => {
  const a = fixtureSimpleSMA();
  const b = { ...a, metadata: { ...a.metadata, createdAt: 999999999, description: "totally different description", author: "someone else", tags: ["x", "y"] } };
  assert.equal(computeCanonicalIRHash(a), computeCanonicalIRHash(b));
});

test("Q0.7.34: computeCanonicalIRHash DOES change when executable semantics change (entry direction flipped)", () => {
  const a = fixtureSimpleSMA();
  const b = { ...a, entries: a.entries.map((e) => ({ ...e, direction: "SELL" as const })) };
  assert.notEqual(computeCanonicalIRHash(a), computeCanonicalIRHash(b));
});

test("Q0.7.36: canonicalizeExpression makes A AND B and B AND A hash identically (commutative reorder, not algebraic simplification)", () => {
  const sma = indicator("SMA", 20);
  const A = comparison(">", indicatorOperand(sma), literal(100));
  const B = comparison("<", indicatorOperand(sma), literal(200));

  const forward = canonicalizeExpression(and(A, B));
  const backward = canonicalizeExpression(and(B, A));
  assert.deepEqual(forward, backward);
});

test("Q0.7.36: comparison left/right are NEVER reordered (not commutative) — A > B stays distinct from B < A even though they are logically equivalent", () => {
  const sma = indicator("SMA", 20);
  const greaterThan = comparison(">", indicatorOperand(sma), literal(100));
  const lessThanReversed = comparison("<", literal(100), indicatorOperand(sma));
  const canonA = canonicalizeExpression(greaterThan);
  const canonB = canonicalizeExpression(lessThanReversed);
  assert.notDeepEqual(canonA, canonB); // structurally distinct — canonicalization is not algebraic simplification (Q0.7.36's explicit rule)
});

test("Q0.7.36: canonicalization does not simplify A AND A into A (no unsafe algebraic transformations)", () => {
  const sma = indicator("SMA", 20);
  const A = comparison(">", indicatorOperand(sma), literal(100));
  const canonical = canonicalizeExpression(and(A, A));
  assert.equal(canonical.type, "logical");
  if (canonical.type === "logical") assert.equal(canonical.operands.length, 2);
});

test("three independent hash computations of the same fixture produce the identical hash (determinism)", () => {
  const h1 = computeCanonicalIRHash(fixtureSimpleSMA());
  const h2 = computeCanonicalIRHash(fixtureSimpleSMA());
  const h3 = computeCanonicalIRHash(fixtureSimpleSMA());
  assert.equal(h1, h2);
  assert.equal(h2, h3);
});
