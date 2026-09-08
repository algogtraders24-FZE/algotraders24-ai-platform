import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoldenStrategySpec,
  GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
  GOLDEN_STRATEGY_PRICE_INDICATOR,
} from "../src/reference/golden-strategy.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { indicatorKey } from "../src/domain/indicator-reference.js";
import type { SimulationConfig } from "../src/runtime/simulation/simulation-engine.js";
import type { Instrument, OHLCVBar, Timeframe } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "SIMFIXTURE", assetClass: "other" };
const TIMEFRAME: Timeframe = "H1";
const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

function bar(index: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: INSTRUMENT, timeframe: TIMEFRAME, open: close, high: close + 1, low: close - 1, close, volume: 1000 };
}

function configFor(spec: ReturnType<typeof buildGoldenStrategySpec>): SimulationConfig {
  return {
    strategySpec: spec,
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "p3.4-param-test",
    datasetVersion: "1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: new Map(),
  };
}

test("P3.4: buildGoldenStrategySpec() with no arguments is unchanged from every pre-P3.4 caller", () => {
  const spec = buildGoldenStrategySpec();
  assert.equal(spec.parameters.length, 0, "parameters stays [] - no runtime consumer exists for it, see the module's own doc comment");
  assert.equal(spec.entryRules.length, 1);
  const condition = spec.entryRules[0]!.condition;
  assert.equal(condition.type, "comparison");
  if (condition.type !== "comparison") throw new Error("unreachable");
  assert.deepEqual(condition.right, { kind: "literal", value: GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD });
  assert.equal(GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD, 100, "the P3.3 canonical baseline's own hardcoded value");
});

test("P3.4: buildGoldenStrategySpec({}) is structurally identical to buildGoldenStrategySpec()", () => {
  assert.deepEqual(buildGoldenStrategySpec({}), buildGoldenStrategySpec());
});

test("P3.4: an explicit default-matching priceThreshold produces a byte-identical spec to the no-arg call", () => {
  assert.deepEqual(buildGoldenStrategySpec({ priceThreshold: GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD }), buildGoldenStrategySpec());
});

test("P3.4: a non-default priceThreshold changes only the entry condition's literal, nothing else in the spec", () => {
  const withOverride = buildGoldenStrategySpec({ priceThreshold: 250 });
  const withDefault = buildGoldenStrategySpec();
  const condition = withOverride.entryRules[0]!.condition;
  assert.equal(condition.type, "comparison");
  if (condition.type !== "comparison") throw new Error("unreachable");
  assert.deepEqual(condition.right, { kind: "literal", value: 250 });
  // Every other field is untouched - this is a targeted, single-field substitution, never a second code path.
  assert.equal(withOverride.identity.strategyId, withDefault.identity.strategyId);
  assert.equal(withOverride.version, withDefault.version);
  assert.deepEqual(withOverride.risk, withDefault.risk);
  assert.deepEqual(withOverride.execution, withDefault.execution);
  assert.deepEqual(withOverride.parameters, withDefault.parameters);
});

test("P3.4: priceThreshold genuinely affects execution - a threshold above every bar's price produces zero entries", () => {
  const bars = [bar(0, 90), bar(1, 95), bar(2, 101), bar(3, 105), bar(4, 110)];
  const indicatorSeries = new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);

  const defaultResult = runSimulation(bars, { ...configFor(buildGoldenStrategySpec()), indicatorSeries });
  assert.ok(defaultResult.tradeLedger.length > 0 || defaultResult.finalPositions.length > 0, "default threshold (100) is crossed by bar 2's close (101) - an entry must occur");

  const neverEntersResult = runSimulation(bars, { ...configFor(buildGoldenStrategySpec({ priceThreshold: 1000 })), indicatorSeries });
  assert.equal(neverEntersResult.tradeLedger.length, 0, "threshold 1000 is never crossed by these bars - zero trades, not an error");
  assert.equal(neverEntersResult.finalPositions.length, 0);
});

test("P3.4: identical, explicit priceThreshold across two independent simulation runs produces a byte-identical resultHash (determinism)", () => {
  const bars = [bar(0, 90), bar(1, 95), bar(2, 101), bar(3, 105), bar(4, 110)];
  const indicatorSeries = new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);
  const runA = runSimulation(bars, { ...configFor(buildGoldenStrategySpec({ priceThreshold: 92 })), indicatorSeries });
  const runB = runSimulation(bars, { ...configFor(buildGoldenStrategySpec({ priceThreshold: 92 })), indicatorSeries });
  assert.equal(runA.resultHash, runB.resultHash);
});
