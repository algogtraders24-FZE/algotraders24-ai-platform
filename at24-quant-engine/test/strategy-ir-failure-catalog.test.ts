import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { canonicalizeExpression } from "../src/runtime/strategy-ir/canonicalize.js";
import { and, comparison, indicatorOperand, literal, seriesOperand, validateExpression } from "../src/domain/expression.js";
import { indicator } from "../src/domain/indicator-reference.js";
import { fixtureSimpleSMA, fixtureEMACrossover } from "./fixtures/strategy-ir-fixtures.js";
import type { MarketState } from "../src/domain/market-state.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { SIM_INSTRUMENT, SIM_TIMEFRAME } from "./fixtures/simulation-fixtures.js";

/** Q0.7.55: the 20 required failure modes, each proven with a concrete test. */

test("1. missing strategy identity: an empty strategyId is rejected", () => {
  const ir = { ...fixtureSimpleSMA(), strategyId: "" };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /strategyId must not be empty/);
});

test("2. invalid timeframe: an empty timeframes array is rejected", () => {
  const ir = { ...fixtureSimpleSMA(), timeframes: [] };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /timeframes must contain at least one Timeframe/);
});

test("3. future offset: a negative series offset is rejected, never silently clamped", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, entries: [{ ...ir.entries[0]!, condition: comparison(">", seriesOperand("CLOSE", -3), literal(0)) }] };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /future offsets are rejected/);
});

test("4. unknown indicator: a condition referencing an undeclared indicator is rejected", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, entries: [{ ...ir.entries[0]!, condition: comparison(">", indicatorOperand(indicator("RSI", 99)), literal(50)) }] };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /unknown indicator/);
});

test("5. invalid parameter: a StrategyParameterDefinition with min > max is rejected", () => {
  const ir = { ...fixtureSimpleSMA(), parameters: [{ key: "length", type: "number" as const, defaultValue: 20, min: 100, max: 10 }] };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /min must be <= max/);
});

test("6. unsupported order type: an executionType outside the known OrderTypeIR set is rejected (a real parser could emit an untyped value)", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, entries: [{ ...ir.entries[0]!, executionType: "TRAILING_STOP" as never }] };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /not a recognized OrderTypeIR/);
});

test("7. ambiguous platform semantics: a PLATFORM_DEFINED reversal behavior with no platformDefaultDescription is rejected", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, positionManagement: { ...ir.positionManagement, reversal: { buyToSell: "PLATFORM_DEFINED" as const, sellToBuy: "PLATFORM_DEFINED" as const } } };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /ambiguous platform semantics/);
});

test("8. repainting behavior: an UNKNOWN repainting model is structurally valid but never execution-eligible", () => {
  const ir = { ...fixtureSimpleSMA(), repaintingModel: "UNKNOWN" as const };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, true);
  assert.equal(result.executionEligible, false);
});

test("9. future MTF data: a HIGHER-role series claiming HTF_OPEN_AVAILABLE is blocked, never a silently-accepted execution mode", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, timeframeSeries: [...ir.timeframeSeries, { timeframe: "H4" as const, role: "HIGHER" as const, availabilityPolicy: "HTF_OPEN_AVAILABLE" as const, alignmentPolicy: "CLOSE_ALIGNED" as const }] };
  const result = validateStrategyIR(badIr);
  assert.equal(result.executionEligible, false);
  assert.match(result.blockingReasons.join(";"), /only HTF_CLOSE_AVAILABLE is a safe/);
});

test("10. timezone missing: an empty strategyTimezone is rejected", () => {
  const ir = { ...fixtureSimpleSMA(), timezone: { strategyTimezone: "" } };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /strategyTimezone must be set explicitly/);
});

test("11. source hash mismatch: provenance.sourceHash disagreeing with the top-level sourceHash is rejected", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, provenance: { ...ir.provenance, sourceHash: "f".repeat(64) } };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /source\/IR identity mismatch/);
});

test("12. invalid risk: a non-positive fixed-quantity sizing is rejected (Q0.2's own validateRiskSpecification, reused unmodified)", () => {
  const ir = { ...fixtureSimpleSMA(), risk: { sizing: { method: "fixed-quantity" as const, quantity: -1 } } };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /quantity must be > 0/);
});

test("13. unsupported execution assumption: all costs unset without costsExplicitlyZero is rejected (Q0.2's own validateExecutionSpecification, reused unmodified)", () => {
  const ir = { ...fixtureSimpleSMA(), execution: { declared: { fillModel: "next-bar-open" as const }, platformDefaultsUsed: [] } };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /execution costs.*are all unset/);
});

test("14. invalid cross semantics: a cross_above/below with an unavailable previous value evaluates to a defined false, never throws (Q0.2's own semantics, preserved)", () => {
  const bars = [{ timestamp: 1000, instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, open: 100, high: 100, low: 100, close: 100, volume: 1 }];
  const state: MarketState = { instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, asOf: 1000, bars, indicatorValues: new Map([["EMA(5)", 10], ["EMA(20)", 8]]) };
  const expr = comparison("cross_above", indicatorOperand(indicator("EMA", 5)), indicatorOperand(indicator("EMA", 20)));
  assert.doesNotThrow(() => evaluateExpression(expr, state));
  assert.equal(evaluateExpression(expr, state), false);
});

test("15. malformed expression: a NOT with 2 operands is rejected (Q0's own validateExpression, reused unmodified)", () => {
  const bad = { type: "logical" as const, operator: "NOT" as const, operands: [comparison(">", literal(1), literal(0)), comparison(">", literal(2), literal(0))] };
  const result = validateExpression(bad);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /NOT must have exactly 1 operand/);
});

test("16. unsupported account mode: HEDGING is structurally valid IR but UNSUPPORTED by AT24's execution engine today (see strategy-ir-execution-compatibility.test.ts for the full compatibility-report proof)", () => {
  const ir = { ...fixtureSimpleSMA(), positionManagement: { ...fixtureSimpleSMA().positionManagement, accountingMode: "HEDGING" as const } };
  const result = validateStrategyIR(ir); // structurally fine — HEDGING is a valid IR value, just not YET simulatable
  assert.equal(result.valid, true);
});

test("17. hidden approximation: semanticStatus APPROXIMATED with an empty approximations array is rejected", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, provenance: { ...ir.provenance, semanticStatus: "APPROXIMATED" as const, approximations: [] } };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /approximation must never be hidden/);
});

test("18. non-deterministic canonicalization: shuffling AND operands before canonicalizing always converges to the identical structure", () => {
  const sma = indicator("SMA", 20);
  const A = comparison(">", indicatorOperand(sma), literal(100));
  const B = comparison("<", indicatorOperand(sma), literal(200));
  const C = comparison("!=", indicatorOperand(sma), literal(150));
  const order1 = canonicalizeExpression(and(A, B, C));
  const order2 = canonicalizeExpression(and(C, A, B));
  const order3 = canonicalizeExpression(and(B, C, A));
  assert.deepEqual(order1, order2);
  assert.deepEqual(order2, order3);
});

test("19. source/IR mismatch: provenance.sourcePlatform disagreeing with the top-level sourcePlatform is rejected", () => {
  const ir = fixtureSimpleSMA();
  const badIr = { ...ir, provenance: { ...ir.provenance, sourcePlatform: "MT4_MQL4" as const } };
  const result = validateStrategyIR(badIr);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /provenance.sourcePlatform must match/);
});

test("20. invalid version: a non-semver strategyVersion is rejected (Q0's own validateStrategyVersionString, reused unmodified)", () => {
  const ir = { ...fixtureSimpleSMA(), strategyVersion: "not-a-version" };
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /MAJOR\.MINOR\.PATCH/);
});

test("bonus: fixtureEMACrossover's own SIGNAL_EXIT is structurally fine, just execution-UNSUPPORTED — proving structural validity and execution eligibility are genuinely independent axes (Q0.7.22)", () => {
  const result = validateStrategyIR(fixtureEMACrossover());
  assert.equal(result.valid, true);
  assert.equal(result.executionEligible, true); // SIGNAL_EXIT is a structural-validity non-issue; execution UNSUPPORTED is reported separately by computeExecutionCompatibility, not blockingReasons
});
