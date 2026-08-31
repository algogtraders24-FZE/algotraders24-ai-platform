/**
 * Q0.10.36 performance baseline for breakeven/trailing/partial-close/
 * max-holding evaluation and their full simulation-engine execution.
 * Correctness first — this is a measurement script, not a gate; nothing
 * here asserts a threshold. Run with: npm run benchmark:position-management
 */
import { evaluateBreakeven } from "../src/runtime/risk/breakeven.js";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import { evaluatePartialClose } from "../src/runtime/risk/partial-close.js";
import { evaluateMaxHoldingPeriod } from "../src/runtime/risk/holding-period.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, buildManagementConfig } from "../test/fixtures/q10-position-management-fixtures.js";

const N = 100_000;

function time(label: string, fn: () => void, iterations: number = N): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / iterations) * 1000).toFixed(3)}us/op, N=${iterations})`);
}

console.log(`AT24 Quant Engine — Q0.10 Position Management Performance Baseline (N=${N})\n`);

time("evaluateBreakeven x N", () => {
  for (let i = 0; i < N; i++) evaluateBreakeven({ trigger: { mode: "absolute", value: 3 }, lockOffset: { mode: "absolute", value: 0 } }, "BUY", 100, 106, undefined, 96);
});

time("evaluateTrailingStop (fixed-distance) x N", () => {
  for (let i = 0; i < N; i++) evaluateTrailingStop({ activation: { mode: "absolute", value: 3 }, distance: { mode: "absolute", value: 2 } }, "BUY", 100, 108, 96, undefined);
});

time("evaluateTrailingStop (atr-multiple) x N", () => {
  for (let i = 0; i < N; i++) evaluateTrailingStop({ activation: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 }, distance: { mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 } }, "BUY", 100, 108, 96, 2);
});

time("evaluatePartialClose x N", () => {
  for (let i = 0; i < N; i++) evaluatePartialClose({ trigger: { mode: "absolute", value: 3 }, closePercent: 50 }, "BUY", 100, 105, undefined, false);
});

time("evaluateMaxHoldingPeriod x N", () => {
  for (let i = 0; i < N; i++) evaluateMaxHoldingPeriod({ sizing: { method: "fixed-quantity", quantity: 1 }, maxHoldingPeriod: { maxBars: 5 } }, { entryTimestamp: 0, barsHeld: 3 }, 100_000);
});

const combinedRisk = {
  sizing: { method: "fixed-quantity" as const, quantity: 1 },
  stopLoss: { type: "fixed-distance" as const, distance: 5 },
  breakeven: { trigger: { mode: "absolute" as const, value: 3 }, lockOffset: { mode: "absolute" as const, value: 0 } },
  trailingStop: { activation: { mode: "absolute" as const, value: 5 }, distance: { mode: "absolute" as const, value: 2 } },
};
const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 106, 102.5, 105), bar(3, 106, 109, 105.5, 108), bar(4, 107, 107.5, 105, 106)];
const config = buildManagementConfig(bars, "BUY", combinedRisk);
const N_SIM = 5_000;
time(
  `runSimulation (5-bar, breakeven+trailing) x ${N_SIM}`,
  () => {
    for (let i = 0; i < N_SIM; i++) runSimulation(bars, config);
  },
  N_SIM,
);
