import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMarketSeries } from "../src/domain/market-series.js";
import { validateExecutionSpecification } from "../src/domain/execution-specification.js";
import { computeCanonicalHash } from "../src/runtime/determinism.js";
import { freezeStrategyVersion, verifyStrategyVersionIntegrity } from "../src/domain/strategy-version.js";
import { TimeFrontier } from "../src/runtime/time-frontier.js";
import { calculateSeries } from "../src/runtime/indicator-engine.js";
import { sma } from "../src/indicators/sma.js";
import { comparison, indicatorOperand } from "../src/domain/expression.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import { FIXTURE_TREND, FIXTURE_DUPLICATES, FIXTURE_INSTRUMENT, FIXTURE_TIMEFRAME } from "./fixtures/golden-fixtures.js";
import { buildStrategySpec } from "./fixtures.js";

/**
 * Q0.2.19: the Q0.1 failure catalog turned into executable tests. Each
 * test here is a single, named failure mode a future backtest/execution
 * engine must never reintroduce. Some assertions overlap with
 * feature-specific test files by design — this file is the auditable
 * "safety net" list, not a search for new coverage.
 */

test("FAILURE MODE: future data access — a TimeFrontier at time T never exposes bar T+1", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  frontier.advanceTo(FIXTURE_TREND.bars[5]!.timestamp);
  assert.ok(!frontier.availableBars().some((b) => b.timestamp > FIXTURE_TREND.bars[5]!.timestamp));
});

test("FAILURE MODE: unordered timestamps — validateMarketSeries rejects a shuffled series", () => {
  const shuffled = { ...FIXTURE_TREND, bars: [FIXTURE_TREND.bars[2]!, FIXTURE_TREND.bars[0]!, FIXTURE_TREND.bars[1]!] };
  assert.equal(validateMarketSeries(shuffled).valid, false);
});

test("FAILURE MODE: duplicate timestamps — validateMarketSeries rejects FIXTURE_DUPLICATES", () => {
  assert.equal(validateMarketSeries(FIXTURE_DUPLICATES).valid, false);
});

test("FAILURE MODE: invalid OHLC — validateMarketSeries rejects high < low", () => {
  const bad = { ...FIXTURE_TREND, bars: [{ ...FIXTURE_TREND.bars[0]!, high: 1, low: 100 }] };
  assert.equal(validateMarketSeries(bad).valid, false);
});

test("FAILURE MODE: missing warmup — an indicator asked for output before warmup completes returns null, not a wrong number", () => {
  const out = calculateSeries(sma, FIXTURE_TREND.bars.slice(0, 3), { period: 20 });
  assert.ok(out.every((v) => v === null));
});

test("FAILURE MODE: cross-event ambiguity — cross_above with no prior observation is defined false, never throws or guesses", () => {
  const fast = indicator("EMA", 3);
  const slow = indicator("EMA", 8);
  const state = {
    instrument: FIXTURE_INSTRUMENT,
    timeframe: FIXTURE_TIMEFRAME,
    asOf: 0,
    bars: [],
    indicatorValues: new Map([[indicatorKey(fast), 105], [indicatorKey(slow), 100]]),
  };
  assert.doesNotThrow(() => evaluateExpression(comparison("cross_above", indicatorOperand(fast), indicatorOperand(slow)), state));
  assert.equal(evaluateExpression(comparison("cross_above", indicatorOperand(fast), indicatorOperand(slow)), state), false);
});

test("FAILURE MODE: nondeterministic hashing — computeCanonicalHash is stable across repeated calls and key-order-independent", () => {
  const a = { z: 1, a: { c: 2, b: 1 } };
  const b = { a: { b: 1, c: 2 }, z: 1 };
  assert.equal(computeCanonicalHash(a), computeCanonicalHash(b));
  assert.equal(computeCanonicalHash(a), computeCanonicalHash(a));
});

test("FAILURE MODE: mutable strategy identity — tampering with a frozen StrategyVersionRecord's spec is detected", () => {
  const spec = buildStrategySpec();
  const record = freezeStrategyVersion(spec, Date.now());
  const tampered = { ...record, spec: { ...record.spec, version: "9.9.9" } };
  assert.equal(verifyStrategyVersionIntegrity(tampered), false);
});

test("FAILURE MODE: hidden execution assumptions — an ExecutionSpecification with all costs unset and no explicit zero-cost flag is rejected", () => {
  assert.equal(validateExecutionSpecification({ fillModel: "next-bar-open" }).valid, false);
});
