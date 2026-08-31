import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { RISK_BREAKEVEN, RISK_TRAILING, RISK_CONFLICT, RISK_DAILY_LOSS } from "./fixtures/risk-fixtures.js";

/**
 * Q0.3.17: evaluateRisk() must not mutate Position, MarketState,
 * StrategySpec, RiskSpecification, or OrderIntent. Proven empirically by
 * deep-freezing every input object (recursively) before evaluation —
 * Object.freeze causes a TypeError on any attempted mutation in strict
 * mode (this package's tsconfig target is ES2022 under Node's default
 * strict ESM semantics), so a silent mutation would surface as a thrown
 * error rather than passing unnoticed.
 */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
  return obj;
}

for (const fixture of [RISK_BREAKEVEN, RISK_TRAILING, RISK_CONFLICT, RISK_DAILY_LOSS]) {
  test(`${fixture.name}: evaluateRisk does not mutate a deep-frozen input`, () => {
    const frozenInput = deepFreeze(structuredClone(fixture.input));
    assert.doesNotThrow(() => evaluateRisk(frozenInput));
  });
}

test("evaluateRisk returns a fresh result object, not a reference into the input", () => {
  const input = structuredClone(RISK_BREAKEVEN.input);
  const result = evaluateRisk(input);
  assert.notEqual(result as unknown, input.riskSpecification as unknown);
  assert.notEqual(result.action as unknown, input.existingPosition as unknown);
});

test("calling evaluateRisk twice on the same (unfrozen) input object leaves the object's own properties unchanged", () => {
  const input = structuredClone(RISK_CONFLICT.input);
  const before = JSON.stringify(input);
  evaluateRisk(input);
  evaluateRisk(input);
  assert.equal(JSON.stringify(input), before);
});
