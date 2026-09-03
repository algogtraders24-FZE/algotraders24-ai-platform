import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REF_EMA_CROSSOVER_SOURCE,
  REF_EMA_CROSSOVER_SOURCE_HASH,
  REF_EMA_CROSSOVER_IR,
  REF_EMA_CROSSOVER_SPEC,
  buildRefEmaCrossoverSpec,
} from "../src/reference/ref-ema-crossover-strategy.js";
import { importMQLSource, computeSourceHash } from "../src/runtime/mql-importer/mql-importer.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import type { SimulationConfig } from "../src/runtime/simulation/simulation-engine.js";
import type { Instrument, OHLCVBar, Timeframe } from "../src/domain/market-data.js";

test("P3.6: the reference strategy is a real MQL5 import - zero unsupported constructs, confirmed by re-running the import fresh in this test (not trusting the module's own load-time check alone)", () => {
  const fresh = importMQLSource({
    sourceText: REF_EMA_CROSSOVER_SOURCE,
    fileName: "AT24_REF_EMA_CROSSOVER.mq5",
    forcedDialect: "MQL5",
    options: { strategyId: "ref-ema-crossover", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  assert.deepEqual(fresh.report.unsupportedConstructs, [], "the reference strategy must import with zero unsupported constructs - unlike G01's real production EA (see docs/ALGO_TESTING_PRO_ROADMAP.md's G01 item), this is the ONE strategy this phase claims genuinely imports");
  assert.equal(computeSourceHash(REF_EMA_CROSSOVER_SOURCE), REF_EMA_CROSSOVER_SOURCE_HASH, "the exported sourceHash must match the exported source text - reproducibility metadata must never drift from what it claims to describe");
});

test("P3.6: the imported IR carries two REAL entry conditions (EMA(9) vs EMA(21)), not placeholder/unrepresented ones", () => {
  assert.equal(REF_EMA_CROSSOVER_IR.entries.length, 2);
  for (const entry of REF_EMA_CROSSOVER_IR.entries) {
    assert.equal(entry.condition.type, "comparison");
    if (entry.condition.type !== "comparison") throw new Error("unreachable");
    assert.equal(entry.condition.left.kind, "indicator");
    assert.equal(entry.condition.right.kind, "indicator");
    if (entry.condition.left.kind !== "indicator" || entry.condition.right.kind !== "indicator") throw new Error("unreachable");
    assert.equal(entry.condition.left.ref.name, "EMA");
    assert.equal(entry.condition.right.ref.name, "EMA");
  }
  // Never a placeholder "1 == 0" / FLAT direction - the honest fallback
  // this test explicitly distinguishes itself from (see G01/Q16 probe
  // findings recorded in docs/P3.6-MULTI-STRATEGY-REGISTRY.md section 2).
  const directions = REF_EMA_CROSSOVER_IR.entries.map((e) => e.direction).sort();
  assert.deepEqual(directions, ["BUY", "SELL"]);
});

test("P3.6: the reduced StrategySpec has real entry rules and no fabricated risk (SL/TP genuinely absent from source, so genuinely absent from the spec - not silently defaulted)", () => {
  assert.equal(REF_EMA_CROSSOVER_SPEC.entryRules.length, 2);
  assert.equal(REF_EMA_CROSSOVER_SPEC.exitRules.length, 0);
  assert.equal(REF_EMA_CROSSOVER_SPEC.risk.stopLoss, undefined);
  assert.equal(REF_EMA_CROSSOVER_SPEC.risk.takeProfit, undefined);
  assert.ok(REF_EMA_CROSSOVER_SPEC.risk.sizing, "a real sizing method must still be present - position sizing is never optional");
});

test("P3.6: buildRefEmaCrossoverSpec() returns the exact same memoized spec every call (deterministic, never re-imports)", () => {
  assert.equal(buildRefEmaCrossoverSpec(), REF_EMA_CROSSOVER_SPEC);
  assert.equal(buildRefEmaCrossoverSpec(), buildRefEmaCrossoverSpec());
});

const INSTRUMENT: Instrument = { symbol: "XAUUSD", assetClass: "metal" };
const TIMEFRAME: Timeframe = "M5";
const BAR_MS = 300_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

function bar(index: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * BAR_MS, instrument: INSTRUMENT, timeframe: TIMEFRAME, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 };
}

function runCrossover(fastSeries: readonly number[], slowSeries: readonly number[]) {
  const bars: OHLCVBar[] = fastSeries.map((_, i) => bar(i, 2000));
  const indicatorSeries = new Map([
    [indicatorKey(indicator("EMA", 9)), fastSeries],
    [indicatorKey(indicator("EMA", 21)), slowSeries],
  ]);
  const config: SimulationConfig = {
    strategySpec: buildRefEmaCrossoverSpec(),
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "p3.6-ref-ema-crossover-test",
    datasetVersion: "1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries,
  };
  return runSimulation(bars, config);
}

test("P3.6: the BUY entry rule produces a REAL position under a genuine EMA crossover (not just a structurally-valid IR that never fires) - the real proof that this is executable, not decorative", () => {
  // Neutral (fast===slow, the comparison is strict > / <, so equal fires
  // neither rule) for two bars, then fast crosses above slow - the fill
  // (next-bar-open) lands one bar after the signal bar, per this engine's
  // own established convention (see docs/P3.5-RISK-CONFIGURATION.md
  // section 3 for the same next-bar-open mechanic proven there).
  const result = runCrossover([100, 100, 100, 105, 106], [100, 100, 100, 100, 100]);
  assert.equal(result.finalPositions.length, 1, "the fast>slow crossover must open a real position - a genuinely inert import (like the hollow G01/Q16 probe findings) would open none");
  assert.equal(result.finalPositions[0]!.side, "BUY");
  assert.equal(result.finalPositions[0]!.entryPrice, 2000);
});

test("P3.6: the SELL entry rule independently produces a REAL position under the opposite crossover - proving BOTH declared entry rules are genuinely reachable, not just one", () => {
  // A fresh, independent simulation (this D1 engine's existing-position
  // handling only ever manages an open position via evaluateRisk()'s
  // protective SL/TP path - this strategy declares none, so an opposite-
  // direction signal while a position is already open would simply HOLD,
  // not auto-reverse; proving the SELL rule on its own, flat-start
  // simulation is the honest way to demonstrate it fires, not a same-run
  // reversal this engine doesn't actually implement for a strategy with
  // no exit rules - see docs/P3.6-MULTI-STRATEGY-REGISTRY.md section 3).
  const result = runCrossover([100, 100, 100, 90, 88], [100, 100, 100, 100, 100]);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.side, "SELL");
  assert.equal(result.finalPositions[0]!.entryPrice, 2000);
});

test("P3.6: no signal (fast===slow throughout) genuinely produces zero positions - the strategy does nothing when nothing is true, not a fabricated default action", () => {
  const result = runCrossover([100, 100, 100, 100, 100], [100, 100, 100, 100, 100]);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.tradeLedger.length, 0);
});

test("P3.6: identical inputs produce a byte-identical resultHash (determinism, same guarantee every other registered strategy carries)", () => {
  const bars: OHLCVBar[] = Array.from({ length: 5 }, (_, i) => bar(i, 2000));
  const indicatorSeries = new Map([
    [indicatorKey(indicator("EMA", 9)), [95, 96, 105, 106, 107]],
    [indicatorKey(indicator("EMA", 21)), [100, 100, 100, 100, 100]],
  ]);
  const config: SimulationConfig = {
    strategySpec: buildRefEmaCrossoverSpec(),
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "p3.6-determinism-test",
    datasetVersion: "1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries,
  };
  const runA = runSimulation(bars, config);
  const runB = runSimulation(bars, config);
  assert.equal(runA.resultHash, runB.resultHash);
});
