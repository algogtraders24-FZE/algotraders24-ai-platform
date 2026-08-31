import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStrategy, computeCompilationHash, REDUCER_VERSION } from "../src/runtime/reduction/compilation.js";
import { fixtureMQL5Netting, fixtureRepainting } from "./fixtures/strategy-ir-fixtures.js";

test("Q0.9: compileStrategy on an eligible IR produces a StrategyCompilationResult with a present strategySpec and a 64+ char hex resultHash", () => {
  const result = compileStrategy(fixtureMQL5Netting());
  assert.ok(result.strategySpec);
  assert.match(result.resultHash, /^[0-9a-f]{64,}$/);
});

test("Q0.9: compileStrategy on a BLOCKED IR still returns a result (never throws) with no strategySpec", () => {
  const result = compileStrategy(fixtureRepainting());
  assert.equal(result.strategySpec, undefined);
  assert.equal(result.reductionReport.status, "BLOCKED");
});

test("Q0.9: computeCompilationHash is deterministic across repeated calls on the same IR", () => {
  const ir = fixtureMQL5Netting();
  const c1 = compileStrategy(ir);
  const c2 = compileStrategy(ir);
  assert.equal(c1.resultHash, c2.resultHash);
});

test("Q0.9: computeCompilationHash changes when the underlying IR's executable semantics change (entry direction flipped)", () => {
  const ir = fixtureMQL5Netting();
  const flipped = { ...ir, entries: ir.entries.map((e) => ({ ...e, direction: e.direction === "BUY" ? ("SELL" as const) : ("BUY" as const) })) };
  const c1 = compileStrategy(ir);
  const c2 = compileStrategy(flipped);
  assert.notEqual(c1.resultHash, c2.resultHash);
});

test("Q0.9: computeCompilationHash is unaffected by ir.metadata.createdAt (pure timestamp, stripped by computeSemanticStrategyHash) but DOES change with strategyId or metadata.name — both flow into StrategySpec.identity, which is semantic content", () => {
  const ir = fixtureMQL5Netting();
  const createdAtOnly = { ...ir, metadata: { ...ir.metadata, createdAt: 999999 } };
  const c1 = compileStrategy(ir);
  const c2 = compileStrategy(createdAtOnly);
  assert.equal(c1.resultHash, c2.resultHash);

  const differentId = { ...ir, strategyId: "a-totally-different-id" };
  const c3 = compileStrategy(differentId);
  assert.notEqual(c1.resultHash, c3.resultHash);

  const renamedOnly = { ...ir, metadata: { ...ir.metadata, name: "A Totally Different Name" } };
  const c4 = compileStrategy(renamedOnly);
  assert.notEqual(c1.resultHash, c4.resultHash);
});

test("Q0.9: two DIFFERENT eligible strategies never collide on resultHash", () => {
  const ir1 = fixtureMQL5Netting();
  const ir2 = { ...ir1, strategyId: "different-strategy", entries: [{ ...ir1.entries[0]!, sizingModel: { method: "fixed-quantity" as const, quantity: 5 } }] };
  const c1 = compileStrategy(ir1);
  const c2 = compileStrategy(ir2);
  assert.notEqual(c1.resultHash, c2.resultHash);
});

test("Q0.9: REDUCER_VERSION is a non-empty string baked into the compilation hash's identity", () => {
  assert.equal(typeof REDUCER_VERSION, "string");
  assert.ok(REDUCER_VERSION.length > 0);
});

test("Q0.9: compileStrategy never mutates the input IR", () => {
  const ir = fixtureMQL5Netting();
  const before = JSON.stringify(ir);
  compileStrategy(ir);
  assert.equal(JSON.stringify(ir), before);
});
