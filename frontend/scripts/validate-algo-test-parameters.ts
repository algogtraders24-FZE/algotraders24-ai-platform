// scripts/validate-algo-test-parameters.ts
// P3.4 - pure unit tests (no DB, no network) for
// services/algo-test/strategy-registry.ts's validateParameterValues() -
// the ONE authoritative place submitted parameter values are validated
// (section 7 of the P3.4 spec: "the frontend must not be the authoritative
// validator"). Real integration tests (a full run against the real DB and
// real Twelve Data, with a real parameter actually affecting the real
// engine result) live in validate-algo-test-service.ts instead - this
// file is deliberately narrower and faster, exercising the validator
// function directly, including synthetic fixture parameters (a
// step-constrained one, a select one, a required one) that the real
// Golden Strategy registry entry does not itself declare - see this
// file's own fixtures below and docs/P3.4-STRATEGY-PARAMETERS.md's audit
// for why the real registry stays deliberately narrower than what this
// validator generically supports.
import assert from "node:assert/strict";
import { STRATEGY_REGISTRY, getStrategyDefinition, validateParameterValues, pickNumericOverrides, type StrategyDefinition } from "../services/algo-test/strategy-registry";
import { GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD, GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE } from "at24-quant-engine";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const golden = getStrategyDefinition("golden");
if (!golden) throw new Error("the 'golden' strategy must be registered");

// A synthetic, test-only strategy fixture - NOT part of the real registry
// - exercising the parameter TYPES/constraints (required, step, select)
// the real Golden Strategy entry doesn't itself need, per this sprint's
// own "only implement what's proven necessary" discipline. Testing the
// generic validator against a fixture is not the same as registering a
// fake parameter in production.
const FIXTURE_STRATEGY: StrategyDefinition = {
  strategyId: "fixture-only",
  strategyVersion: "0.0.1",
  displayName: "Fixture (test-only, never registered)",
  description: "test fixture",
  supportedSymbols: ["XAUUSD"],
  supportedTimeframes: ["5m"],
  status: "available",
  parameters: [
    { id: "requiredNumber", label: "Required Number", description: "", type: "number", category: "signal", defaultValue: 10, required: true },
    { id: "steppedInteger", label: "Stepped Integer", description: "", type: "integer", category: "signal", defaultValue: 5, min: 0, max: 100, step: 5, required: false },
    { id: "mode", label: "Mode", description: "", type: "select", category: "signal", defaultValue: "A", options: ["A", "B", "C"], required: false },
    { id: "enabled", label: "Enabled", description: "", type: "boolean", category: "signal", defaultValue: true, required: false },
  ],
  // P3.6 - the generic contract's other required fields (strategy-registry.ts's
  // own StrategyDefinition). Not exercised by this file's own tests (they only
  // call validateParameterValues(), which reads `parameters` alone) - present
  // only so this synthetic, never-registered fixture still type-checks against
  // the real contract every actual registry entry must satisfy.
  source: { kind: "engine-reference", module: "test-fixture-only" },
  reproducibility: { baseContentHash: "fixture-only" },
  buildSpec: () => {
    throw new Error("FIXTURE_STRATEGY.buildSpec must never actually be called - this fixture only exercises validateParameterValues()");
  },
  buildIndicatorSeries: () => new Map(),
  importLifecycle: [],
};

function main(): void {
  console.log("=== Registry contents (real, production) ===");
  test("STRATEGY_REGISTRY registers two strategies (golden + P3.6's ref-ema-crossover import), through the same generic contract", () => {
    assert.equal(STRATEGY_REGISTRY.length, 2);
    assert.equal(golden!.source.kind, "engine-reference");
    const refEmaCrossover = getStrategyDefinition("ref-ema-crossover");
    assert.ok(refEmaCrossover, "expected the P3.6 reference strategy to be registered");
    assert.equal(refEmaCrossover!.source.kind, "mql-import");
    assert.ok(refEmaCrossover!.reproducibility.baseContentHash.length > 0, "an imported strategy must still carry real reproducibility metadata");
  });

  test("golden's P3.4 entry-parameter and P3.5's three risk parameters are all present", () => {
    assert.equal(golden!.parameters.length, 4);
    const priceThreshold = golden!.parameters.find((p) => p.id === "priceThreshold");
    assert.equal(priceThreshold?.defaultValue, GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD);
    assert.equal(priceThreshold?.required, false);
    for (const id of ["positionSizeQuantity", "stopLossDistance", "takeProfitRMultiple"]) {
      const param = golden!.parameters.find((p) => p.id === id);
      assert.ok(param, `expected a registered parameter with id "${id}"`);
      assert.equal(param!.required, false);
    }
  });

  console.log("\n=== Valid parameters (real 'golden' registry entry) ===");
  test("omitting parameters entirely accepts the registered default", () => {
    const result = validateParameterValues(golden!, undefined);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.normalized.priceThreshold, GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD);
  });

  test("a valid custom value is accepted and normalized", () => {
    const result = validateParameterValues(golden!, { priceThreshold: 4200 });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.normalized.priceThreshold, 4200);
  });

  test("the min boundary itself (0) is accepted, not rejected as 'below minimum'", () => {
    const result = validateParameterValues(golden!, { priceThreshold: 0 });
    assert.ok(result.ok);
  });

  test("the max boundary itself (1,000,000) is accepted, not rejected as 'above maximum'", () => {
    const result = validateParameterValues(golden!, { priceThreshold: 1_000_000 });
    assert.ok(result.ok);
  });

  console.log("\n=== Invalid parameters (real 'golden' registry entry) ===");
  test("an unknown parameter key is rejected", () => {
    const result = validateParameterValues(golden!, { notARealParameter: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.field === "notARealParameter"));
  });

  test("a wrong-typed value (string where a number is required) is rejected, never coerced", () => {
    const result = validateParameterValues(golden!, { priceThreshold: "100" as unknown as number });
    assert.equal(result.ok, false);
  });

  test("a non-finite value (NaN/Infinity) is rejected", () => {
    const result = validateParameterValues(golden!, { priceThreshold: Number.POSITIVE_INFINITY });
    assert.equal(result.ok, false);
  });

  test("below minimum is rejected", () => {
    const result = validateParameterValues(golden!, { priceThreshold: -1 });
    assert.equal(result.ok, false);
  });

  test("above maximum is rejected", () => {
    const result = validateParameterValues(golden!, { priceThreshold: 2_000_000 });
    assert.equal(result.ok, false);
  });

  console.log("\n=== Invalid parameters (synthetic fixture - exercises required/step/select, which the real registry doesn't need today) ===");
  test("a missing required parameter is rejected", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.field === "requiredNumber"));
  });

  test("a value violating its declared step is rejected", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, { requiredNumber: 10, steppedInteger: 7 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.field === "steppedInteger"));
  });

  test("a value exactly on-step is accepted", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, { requiredNumber: 10, steppedInteger: 15 });
    assert.ok(result.ok);
  });

  test("an invalid select option is rejected", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, { requiredNumber: 10, mode: "Z" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.field === "mode"));
  });

  test("a non-boolean value for a boolean parameter is rejected", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, { requiredNumber: 10, enabled: "yes" as unknown as boolean });
    assert.equal(result.ok, false);
  });

  test("a fully valid fixture submission normalizes every declared parameter, defaults filled in for the ones omitted", () => {
    const result = validateParameterValues(FIXTURE_STRATEGY, { requiredNumber: 42 });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.normalized.requiredNumber, 42);
      assert.equal(result.normalized.steppedInteger, 5); // default
      assert.equal(result.normalized.mode, "A"); // default
      assert.equal(result.normalized.enabled, true); // default
    }
  });

  console.log("\n=== Security ===");
  test("the client cannot redefine the schema - submitting schema-shaped keys (min/options/etc) alongside a real value has zero effect on validation rules", () => {
    const maliciousSubmission = { priceThreshold: 50, min: -999_999, max: 999_999, options: ["evil"], type: "string" } as unknown as Record<string, unknown>;
    const result = validateParameterValues(golden!, maliciousSubmission);
    // priceThreshold=50 is genuinely valid, but the extra schema-shaped
    // keys are still unknown parameters and must still be rejected -
    // there is no way for a client submission to loosen or replace the
    // server's own registered constraints.
    assert.equal(result.ok, false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field);
      assert.ok(fields.includes("min"));
      assert.ok(fields.includes("options"));
    }
  });

  test("no arbitrary code execution path exists - a string payload where a number is expected is rejected as a type error, never evaluated", () => {
    const result = validateParameterValues(golden!, { priceThreshold: "100; require('child_process').execSync('echo pwned')" as unknown as number });
    assert.equal(result.ok, false);
  });

  console.log("\n=== P3.7 Generic Parameter Engine ===");
  test("pickNumericOverrides is strategy-agnostic - a wholly synthetic parameter-id list neither golden nor ref-ema-crossover declares still works with zero new mapping code", () => {
    const syntheticIds = ["fooRisk", "barSignal", "bazUnused"] as const;
    const picked = pickNumericOverrides(syntheticIds, { fooRisk: 42, barSignal: 7, notDeclared: 999 });
    assert.deepEqual(picked, { fooRisk: 42, barSignal: 7 }, "only declared ids are picked, undeclared submitted keys are silently ignored (validateParameterValues already rejected them upstream - this function trusts that contract, doesn't re-enforce it)");
  });

  test("pickNumericOverrides ignores a non-numeric value for a declared id, rather than coercing or throwing", () => {
    const picked = pickNumericOverrides(["x"] as const, { x: "not-a-number" });
    assert.deepEqual(picked, {}, "defensive only - validateParameterValues would already have rejected this upstream in real use");
  });

  test("golden.buildSpec() end to end: the SAME generic mechanism, exercised through the real registry entry, produces a spec with genuinely overridden risk - not just a unit-tested helper in isolation", () => {
    const overridden = golden!.buildSpec({ stopLossDistance: 9, takeProfitRMultiple: 3 });
    assert.equal(overridden.risk.stopLoss?.type, "fixed-distance");
    assert.equal(overridden.risk.stopLoss && "distance" in overridden.risk.stopLoss ? overridden.risk.stopLoss.distance : undefined, 9);
    const defaulted = golden!.buildSpec({});
    assert.equal(defaulted.risk.stopLoss && "distance" in defaulted.risk.stopLoss ? defaulted.risk.stopLoss.distance : undefined, GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE, "omitting an override reproduces the engine's own default, same guarantee P3.5 already proved at the engine level - now proven again at the registry's generic-wiring layer");
  });

  test("every registered engine-reference strategy's parameters all declare a real category - no uncategorized signal-affecting parameter slips through", () => {
    for (const strategy of STRATEGY_REGISTRY) {
      if (strategy.source.kind !== "engine-reference") continue;
      for (const param of strategy.parameters) {
        assert.ok(["signal", "risk", "execution", "provider"].includes(param.category), `strategy "${strategy.strategyId}" parameter "${param.id}" has an invalid or missing category`);
      }
    }
  });

  console.log("\n=== P3.8 Validation / Evidence Gate ===");
  test("every registered strategy's own importLifecycle covers exactly IMPORTED/PARSED/IR_VALID/EXECUTION_VALID, in that order, and none of them are FAILED (a FAILED-import-lifecycle strategy would never be safe to register at all)", () => {
    for (const strategy of STRATEGY_REGISTRY) {
      assert.deepEqual(
        strategy.importLifecycle.map((s) => s.stage),
        ["IMPORTED", "PARSED", "IR_VALID", "EXECUTION_VALID"],
        `strategy "${strategy.strategyId}"'s importLifecycle must cover exactly these 4 stages, in order`,
      );
      for (const stage of strategy.importLifecycle) {
        assert.notEqual(stage.outcome, "FAILED", `strategy "${strategy.strategyId}" stage "${stage.stage}" is FAILED - a strategy whose own import lifecycle fails must never be registered/available`);
      }
    }
  });

  test("golden's importLifecycle is NOT_APPLICABLE for all 4 stages (never imported); ref-ema-crossover's is PASSED for all 4 (a real MQL5 import) - the two real, different `source.kind`s produce genuinely different, correct lifecycle outcomes", () => {
    const goldenStages = golden!.importLifecycle.map((s) => s.outcome);
    assert.deepEqual(goldenStages, ["NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
    const refEmaCrossover = getStrategyDefinition("ref-ema-crossover");
    assert.ok(refEmaCrossover);
    const refStages = refEmaCrossover!.importLifecycle.map((s) => s.outcome);
    assert.deepEqual(refStages, ["PASSED", "PASSED", "PASSED", "PASSED"]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
