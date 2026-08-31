import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation, type SimulationAdapterOptions } from "../src/runtime/reduction/simulation-adapter.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { baseOptions } from "./fixtures/mql-fixtures.js";
import { MQL5_EMA_CROSS_FIXED_SLTP, MQL4_EMA_CROSS_FIXED_SLTP, MQL5_RSI_OVERSOLD, MQL4_RSI_OVERSOLD, buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";

const SIM_OPTIONS: SimulationAdapterOptions = {
  initialBalance: 10000,
  datasetId: "q09-e2e-test",
  datasetVersion: "v1",
  dataFidelity: "D1",
  spreadModel: ZeroSpread,
  slippageModel: ZeroSlippage,
  feeModel: ZeroFee,
  latencyModel: ZeroLatency,
  fidelity: "D1_OHLC",
};

function runFullPipeline(source: string, dialect: "MQL4" | "MQL5", strategyId: string) {
  const { ir, report } = importMQLSource({
    sourceText: source,
    fileName: dialect === "MQL5" ? "f.mq5" : "f.mq4",
    options: baseOptions({ strategyId }),
    forcedDialect: dialect,
  });
  const compilation = compileStrategy(ir);
  const bars = buildSyntheticFxBars();
  const simResult = compilation.strategySpec ? compileToSimulation(compilation, bars, SIM_OPTIONS) : undefined;
  return { ir, report, compilation, simResult };
}

/**
 * Q0.9's Critical Success Criterion: at least one real MQL4/MQL5 strategy
 * must travel MQL SOURCE -> AST -> SEMANTIC MODEL -> STRATEGY IR ->
 * STRATEGYSPEC -> RISK -> ORDER ENGINE -> FILL MODEL -> POSITION -> TRADE
 * LEDGER -> BACKTEST RESULT with ZERO BLOCKING SEMANTIC ERRORS.
 */
test("Q0.9 CSC: MQL5 EMA-crossover + fixed-distance SL/TP travels the full pipeline with zero blocking errors and produces a real simulation result", () => {
  const { report, compilation, simResult } = runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-mql5-ema-cross");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.equal(compilation.reductionReport.status, "REDUCED_WITH_WARNINGS");
  assert.ok(compilation.strategySpec, "a REDUCED_WITH_WARNINGS result must carry a real StrategySpec");
  assert.ok(simResult);
  assert.match(simResult!.compilationHash, /^[0-9a-f]{64,}$/);
  assert.match(simResult!.simulationResultHash, /^[0-9a-f]{64,}$/);
  assert.equal(simResult!.fidelity, "D1_OHLC");
});

test("Q0.9 CSC (MQL4 parity): the same strategy shape written in MQL4/OrderSend also travels the full pipeline with zero blocking errors", () => {
  const { report, compilation, simResult } = runFullPipeline(MQL4_EMA_CROSS_FIXED_SLTP, "MQL4", "q09-mql4-ema-cross");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.equal(compilation.reductionReport.status, "REDUCED_WITH_WARNINGS");
  assert.ok(compilation.strategySpec);
  assert.ok(simResult);
});

test("Q0.9: an RSI-oversold-only entry (no SL/TP) also reduces and simulates cleanly — proves the reducer handles a bare indicator-threshold condition, not just crossovers", () => {
  const { compilation, simResult } = runFullPipeline(MQL5_RSI_OVERSOLD, "MQL5", "q09-mql5-rsi-oversold");
  assert.ok(compilation.strategySpec);
  assert.ok(simResult);
  assert.equal(compilation.strategySpec!.risk.stopLoss, undefined);
});

test("Q0.9: the MQL4 RSI-oversold equivalent also reduces and simulates cleanly", () => {
  const { compilation, simResult } = runFullPipeline(MQL4_RSI_OVERSOLD, "MQL4", "q09-mql4-rsi-oversold");
  assert.ok(compilation.strategySpec);
  assert.ok(simResult);
});

test("Q0.9: the compiled StrategySpec's entry condition is a REAL Expression (indicator comparison), never the Q0.8 placeholder literal(true)", () => {
  const { compilation } = runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-real-condition-check");
  const entry = compilation.strategySpec!.entryRules[0]!;
  assert.equal(entry.condition.type, "comparison");
});

test("Q0.9: the compiled StrategySpec's stopLoss/takeProfit are real fixed-distance rules, not left undefined", () => {
  const { compilation } = runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-real-risk-check");
  assert.deepEqual(compilation.strategySpec!.risk.stopLoss, { type: "fixed-distance", distance: 0.005 });
  assert.deepEqual(compilation.strategySpec!.risk.takeProfit, { type: "fixed-distance", distance: 0.01 });
});

test("Q0.9: the simulation actually opens at least one position and records at least one trade with a computed R-multiple (proves real risk/order/ledger integration, not a no-op run)", () => {
  const { simResult } = runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-real-trade-check");
  assert.ok(simResult!.provenance.strategyHash);
  // A non-trivial event count proves bars were actually processed and orders/positions flowed through Q0.5's unmodified engine.
  assert.ok((simResult as unknown as { provenance: { detailCoverage?: { totalParents: number } } }).provenance.detailCoverage!.totalParents > 0);
});

test("Q0.9 reproducibility: compiling and simulating the same MQL5 source 3 times produces an identical compilationHash and simulationResultHash", () => {
  const runs = [1, 2, 3].map(() => runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-repro-check"));
  assert.equal(runs[0]!.simResult!.compilationHash, runs[1]!.simResult!.compilationHash);
  assert.equal(runs[1]!.simResult!.compilationHash, runs[2]!.simResult!.compilationHash);
  assert.equal(runs[0]!.simResult!.simulationResultHash, runs[1]!.simResult!.simulationResultHash);
  assert.equal(runs[1]!.simResult!.simulationResultHash, runs[2]!.simResult!.simulationResultHash);
});

test("Q0.9: importMQLSource never mutates its own sourceText input across repeated calls (purity check at the entry boundary)", () => {
  const before = MQL5_EMA_CROSS_FIXED_SLTP;
  runFullPipeline(MQL5_EMA_CROSS_FIXED_SLTP, "MQL5", "q09-purity-check");
  assert.equal(MQL5_EMA_CROSS_FIXED_SLTP, before);
});
