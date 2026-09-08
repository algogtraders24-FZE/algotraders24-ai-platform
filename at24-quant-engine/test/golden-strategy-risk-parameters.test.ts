import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoldenStrategySpec,
  GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
  GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
  GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
  GOLDEN_STRATEGY_PRICE_INDICATOR,
} from "../src/reference/golden-strategy.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { computeSemanticStrategyHash } from "../src/runtime/identity.js";
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

function configFor(spec: ReturnType<typeof buildGoldenStrategySpec>, indicatorSeries: ReadonlyMap<string, readonly (number | boolean | undefined)[]>): SimulationConfig {
  return {
    strategySpec: spec,
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "p3.5-risk-param-test",
    datasetVersion: "1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries,
  };
}

test("P3.5: buildGoldenStrategySpec() with no arguments is unchanged (backward compatibility with pre-P3.5 callers)", () => {
  const spec = buildGoldenStrategySpec();
  assert.deepEqual(spec.risk, {
    sizing: { method: "fixed-quantity", quantity: GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY },
    stopLoss: { type: "fixed-distance", distance: GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE },
    takeProfit: { type: "risk-multiple", rMultiple: GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE },
  });
  assert.equal(GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY, 1, "the pre-P3.5 hardcoded value");
  assert.equal(GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE, 5, "the pre-P3.5 hardcoded value");
  assert.equal(GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE, 2, "the pre-P3.5 hardcoded value");
});

test("P3.5: explicit default-matching risk parameters produce a byte-identical spec to the no-arg call", () => {
  const withExplicitDefaults = buildGoldenStrategySpec({
    positionSizeQuantity: GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
    stopLossDistance: GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
    takeProfitRMultiple: GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
  });
  assert.deepEqual(withExplicitDefaults, buildGoldenStrategySpec());
});

test("P3.5: a non-default risk parameter changes only the risk block, nothing else in the spec", () => {
  const withOverride = buildGoldenStrategySpec({ stopLossDistance: 2, takeProfitRMultiple: 4, positionSizeQuantity: 3 });
  const withDefault = buildGoldenStrategySpec();
  assert.deepEqual(withOverride.risk, {
    sizing: { method: "fixed-quantity", quantity: 3 },
    stopLoss: { type: "fixed-distance", distance: 2 },
    takeProfit: { type: "risk-multiple", rMultiple: 4 },
  });
  // Every other field is untouched - same "targeted, single-block substitution" discipline as P3.4's priceThreshold test.
  assert.equal(withOverride.identity.strategyId, withDefault.identity.strategyId);
  assert.equal(withOverride.version, withDefault.version);
  assert.deepEqual(withOverride.entryRules, withDefault.entryRules);
  assert.deepEqual(withOverride.execution, withDefault.execution);
  assert.deepEqual(withOverride.parameters, withDefault.parameters);
});

test("P3.5: a changed risk parameter changes computeSemanticStrategyHash - the exact mechanism this phase depends on (see docs/ALGO_TESTING_PRO_ROADMAP.md section 6)", () => {
  const defaultHash = computeSemanticStrategyHash(buildGoldenStrategySpec());
  const changedHash = computeSemanticStrategyHash(buildGoldenStrategySpec({ stopLossDistance: 2 }));
  assert.notEqual(changedHash, defaultHash, "risk is a top-level StrategySpec field, not under metadata - computeSemanticStrategyHash must already distinguish these");
});

test("P3.5: reverting an override back to the documented default reproduces the exact pre-P3.5 hash - no accidental drift for callers who never touch the new fields", () => {
  const untouchedHash = computeSemanticStrategyHash(buildGoldenStrategySpec());
  const revertedHash = computeSemanticStrategyHash(
    buildGoldenStrategySpec({
      positionSizeQuantity: GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
      stopLossDistance: GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
      takeProfitRMultiple: GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
    }),
  );
  assert.equal(revertedHash, untouchedHash);
});

test("P3.5: stopLossDistance genuinely affects execution - a tighter stop gets hit where the wider default survives (real behavioral effect, not just a structural one)", () => {
  // Enters when close > 100 (bar 2, close 101, the signal bar). Confirmed
  // empirically (not assumed): the protective stop/take-profit are computed
  // relative to the SIGNAL bar's own close (101) - not the actual next-bar-
  // open fill price (105) - so stopPrice = 101 - stopLossDistance. Bar 4's
  // low (96) sits between the two stop levels under test: below the tight
  // stop (distance 2 -> stop 99, triggered) but above the wide stop
  // (distance 10 -> stop 91, survives). takeProfitRMultiple is pinned to an
  // effectively unreachable value in the tight-stop run specifically to
  // isolate the stop-loss effect from take-profit (rMultiple 2's own default
  // TP, 101 + 2*2 = 105, would otherwise be hit by the entry fill itself at
  // 105 - a real interaction this test deliberately avoids conflating with).
  const bars: OHLCVBar[] = [
    bar(0, 90),
    bar(1, 95),
    bar(2, 101),
    bar(3, 105),
    { timestamp: BASE_TS + 4 * HOUR_MS, instrument: INSTRUMENT, timeframe: TIMEFRAME, open: 106, high: 107, low: 96, close: 106, volume: 1000 },
    bar(5, 110),
  ];
  const indicatorSeries = new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);

  const tightStopResult = runSimulation(bars, configFor(buildGoldenStrategySpec({ stopLossDistance: 2, takeProfitRMultiple: 1000 }), indicatorSeries));
  const wideStopResult = runSimulation(bars, configFor(buildGoldenStrategySpec({ stopLossDistance: 10 }), indicatorSeries));

  assert.ok(tightStopResult.tradeLedger.length > 0, "the tight-stop run must have closed at least one trade via its protective stop");
  const tightExit = tightStopResult.tradeLedger[0]!.exitReason;
  assert.match(String(tightExit), /stop/i, `expected a stop-loss exit reason, got: ${String(tightExit)}`);
  assert.equal(tightStopResult.tradeLedger[0]!.exitPrice, 99, "stop price = signal close (101) - distance (2)");

  assert.equal(wideStopResult.tradeLedger.length, 0, "the wide-stop run must still be holding the position open - stop 91 (101 - 10) is never reached by this fixture's low (96)");
  assert.equal(wideStopResult.finalPositions.length, 1);

  assert.notEqual(tightStopResult.resultHash, wideStopResult.resultHash);
});

test("P3.5: identical, explicit risk parameters across two independent simulation runs produce a byte-identical resultHash (determinism)", () => {
  const bars = [bar(0, 90), bar(1, 95), bar(2, 101), bar(3, 105), bar(4, 110)];
  const indicatorSeries = new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);
  const params = { stopLossDistance: 3, takeProfitRMultiple: 1.5, positionSizeQuantity: 2 };
  const runA = runSimulation(bars, configFor(buildGoldenStrategySpec(params), indicatorSeries));
  const runB = runSimulation(bars, configFor(buildGoldenStrategySpec(params), indicatorSeries));
  assert.equal(runA.resultHash, runB.resultHash);
});
