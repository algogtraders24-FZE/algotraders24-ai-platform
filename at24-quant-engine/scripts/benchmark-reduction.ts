/**
 * Q0.9 performance baseline for the reduction/compilation/simulation-bridge
 * layer: IR -> StrategySpec (reduceStrategyIRToSpec/compileStrategy) and
 * StrategySpec -> simulation (compileToSimulation). Measurement only
 * (matches Q0.2.22's own "correctness-first, no thresholds" convention) —
 * run with:
 *   npx tsx scripts/benchmark-reduction.ts
 */
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation, type SimulationAdapterOptions } from "../src/runtime/reduction/simulation-adapter.js";
import { fixtureMQL5Netting, fixtureEMACrossover } from "../test/fixtures/strategy-ir-fixtures.js";
import { buildSyntheticFxBars } from "../test/fixtures/q09-mql-e2e-fixtures.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";

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

console.log(`AT24 Quant Engine — Q0.9 Reduction/Compilation/Simulation-Bridge Performance Baseline (N=${N})\n`);

const netting = fixtureMQL5Netting();
const ema = fixtureEMACrossover();
const emaIr = { ...netting, indicators: ema.indicators, entries: ema.entries, exits: [] };
const bars = buildSyntheticFxBars(200, emaIr.instruments[0]!.symbol, emaIr.timeframes[0]!);

benchmark("compileStrategy (IR -> StrategySpec, eligible)", N, () => compileStrategy(netting));
benchmark("compileStrategy (IR -> StrategySpec, BLOCKED)", N, () => compileStrategy(fixtureEMACrossover()));
benchmark("compileStrategy (with 2 real indicators)", N, () => compileStrategy(emaIr));

const compilation = compileStrategy(emaIr);
const options: SimulationAdapterOptions = {
  initialBalance: 10000,
  datasetId: "bench",
  datasetVersion: "v1",
  dataFidelity: "D1",
  spreadModel: ZeroSpread,
  slippageModel: ZeroSlippage,
  feeModel: ZeroFee,
  latencyModel: ZeroLatency,
  fidelity: "D1_OHLC",
};
benchmark("compileToSimulation (200 bars, 2 indicators, D1_OHLC)", 500, () => compileToSimulation(compilation, bars, options));
