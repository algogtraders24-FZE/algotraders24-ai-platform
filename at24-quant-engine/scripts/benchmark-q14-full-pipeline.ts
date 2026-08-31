/**
 * Q1.4.17 — full-path performance baseline: MQL source text -> lexer ->
 * parser -> semantic analysis -> IR -> compile (reduction + eligibility)
 * -> compileToSimulation (execution). Reuses the IDENTICAL benchmark()/
 * percentile() harness `scripts/benchmark-reduction.ts` (Q0.9) already
 * established — no new benchmark architecture, per Q1.4's own "do not
 * create a new benchmark architecture unless needed" instruction.
 * Measurement only — no thresholds, no gating. Run with:
 *   npx tsx scripts/benchmark-q14-full-pipeline.ts
 */
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation, type SimulationAdapterOptions } from "../src/runtime/reduction/simulation-adapter.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { buildSyntheticFxBars } from "../test/fixtures/q09-mql-e2e-fixtures.js";
import { findQ14Fixture } from "../test/fixtures/q14-mql-corpus.js";

const N = 2_000;

function percentile(sortedMs: readonly number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx]!;
}

function benchmark(label: string, n: number, fn: () => void): void {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1_000_000);
  }
  samples.sort((a, b) => a - b);
  const total = samples.reduce((a, b) => a + b, 0);
  const avg = total / n;
  console.log(
    `${label}: ${(1000 / avg).toFixed(0)} ops/sec | avg ${avg.toFixed(4)}ms | p50 ${percentile(samples, 50).toFixed(4)}ms | p95 ${percentile(samples, 95).toFixed(4)}ms | p99 ${percentile(samples, 99).toFixed(4)}ms (N=${n})`,
  );
}

console.log(`AT24 Quant Engine — Q1.4 Full Import-to-Execution Pipeline Performance Baseline (N=${N})\n`);

const fx = findQ14Fixture("mql4-08-orderselect-ordermodify");
const options = { strategyId: fx.id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5" as const, importedAt: 0 };

benchmark("tokenize (lexer only)", N, () => tokenize(fx.source));

const tokens = tokenize(fx.source);
benchmark("parseMQL (parser only)", N, () => parseMQL(tokens));

benchmark("importMQLSource (lexer+parser+semantic-analyzer+ir-generator, full source->IR)", N, () => importMQLSource({ sourceText: fx.source, fileName: `${fx.id}.mq4`, forcedDialect: "MQL4", options }));

const { ir } = importMQLSource({ sourceText: fx.source, fileName: `${fx.id}.mq4`, forcedDialect: "MQL4", options });
benchmark("compileStrategy (IR -> StrategySpec, with reduction + eligibility)", N, () => compileStrategy(ir));

const compilation = compileStrategy(ir);
const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
const simOptions: SimulationAdapterOptions = { initialBalance: 10_000, datasetId: "q14-bench", datasetVersion: "v1", dataFidelity: "D1", spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" };
benchmark("compileToSimulation (200 bars, D1_OHLC)", 500, () => compileToSimulation(compilation, bars, simOptions));

console.log("\n--- Full end-to-end (source text -> execution result), single combined call ---");
benchmark("SOURCE -> PARSED -> SEMANTIC -> IR -> COMPILE -> ELIGIBILITY -> EXECUTION (combined)", 500, () => {
  const { ir: freshIr } = importMQLSource({ sourceText: fx.source, fileName: `${fx.id}.mq4`, forcedDialect: "MQL4", options });
  const freshCompilation = compileStrategy(freshIr);
  compileToSimulation(freshCompilation, bars, simOptions);
});
