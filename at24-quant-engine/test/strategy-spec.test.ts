import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStrategySpec, validateStrategyVersionString } from "../src/domain/strategy-spec.js";
import { buildStrategySpec } from "./fixtures.js";

test("a well-formed StrategySpec validates successfully", () => {
  const result = validateStrategySpec(buildStrategySpec());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("a StrategySpec with no entry rules is invalid", () => {
  const spec = buildStrategySpec();
  const result = validateStrategySpec({ ...spec, entryRules: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("entryRules must contain at least one")));
});

test("a StrategySpec with no instruments is invalid", () => {
  const spec = buildStrategySpec();
  const result = validateStrategySpec({ ...spec, instruments: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("instruments must contain")));
});

test("duplicate entry rule ids are rejected", () => {
  const spec = buildStrategySpec();
  const duplicated = { ...spec, entryRules: [...spec.entryRules, { ...spec.entryRules[0]! }] };
  const result = validateStrategySpec(duplicated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate entryRule ids")));
});

test("duplicate parameter keys are rejected", () => {
  const spec = buildStrategySpec();
  const duplicated = { ...spec, parameters: [...spec.parameters, { ...spec.parameters[0]! }] };
  const result = validateStrategySpec(duplicated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate parameter keys")));
});

test("an invalid NOT expression (wrong arity) inside an entry rule is rejected", () => {
  const spec = buildStrategySpec();
  const badEntry = {
    ...spec.entryRules[0]!,
    condition: { type: "logical" as const, operator: "NOT" as const, operands: [] },
  };
  const result = validateStrategySpec({ ...spec, entryRules: [badEntry] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("NOT must have exactly 1 operand")));
});

test("version string validation accepts semantic versions", () => {
  assert.equal(validateStrategyVersionString("1.0.0").valid, true);
  assert.equal(validateStrategyVersionString("2.13.4").valid, true);
});

test("version string validation rejects non-semantic versions", () => {
  assert.equal(validateStrategyVersionString("v1").valid, false);
  assert.equal(validateStrategyVersionString("").valid, false);
  assert.equal(validateStrategyVersionString("1.0").valid, false);
});

test("a parameter with min > max is invalid", () => {
  const spec = buildStrategySpec();
  const badParam = { ...spec.parameters[0]!, min: 100, max: 0 };
  const result = validateStrategySpec({ ...spec, parameters: [badParam] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("min must be <= max")));
});
