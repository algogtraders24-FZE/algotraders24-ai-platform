/**
 * Q0.6.41 performance baseline for the multi-fidelity engine. Correctness
 * first — this is a measurement script, not a gate; nothing here asserts
 * a threshold or fails the build. Run with:
 *   npm run benchmark:fidelity
 */
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { FIXTURE_A_PARENT_BARS, buildFixtureAD1Config, buildFixtureAD2Config } from "../test/fixtures/fidelity-fixtures.js";

function time(label: string, iterations: number, fn: () => void): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms total, ${((ms / iterations) * 1000).toFixed(3)}us/op (N=${iterations})`);
}

const N = 1_000;
console.log(`AT24 Quant Engine — Q0.6 Multi-Fidelity Performance Baseline (N=${N})\n`);

time(`D1_OHLC delegation (${FIXTURE_A_PARENT_BARS.length}-bar fixture)`, N, () => {
  const config = buildFixtureAD1Config();
  for (let i = 0; i < N; i++) runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
});

time(`D2_LOWER_TIMEFRAME child-bar-walking engine (${FIXTURE_A_PARENT_BARS.length}-bar fixture, 1 parent with 4 M15 children)`, N, () => {
  const config = buildFixtureAD2Config();
  for (let i = 0; i < N; i++) runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config);
});
