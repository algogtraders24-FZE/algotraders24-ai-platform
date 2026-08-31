/**
 * Q0.3 performance baseline for the Risk Evaluation layer. Correctness
 * first — this is a measurement script, not a gate; nothing here asserts
 * a threshold. Run with: npm run benchmark:risk
 */
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { evaluateMaxSimultaneousPositions } from "../src/runtime/risk/position-limits.js";
import { evaluateDailyLossLimit } from "../src/runtime/risk/daily-loss.js";
import { validateEntryGeometry } from "../src/runtime/risk/geometry.js";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import { RISK_BASIC_BUY, RISK_TRAILING } from "../test/fixtures/risk-fixtures.js";

const N = 100_000;

function time(label: string, fn: () => void): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / N) * 1000).toFixed(3)}us/op, N=${N})`);
}

console.log(`AT24 Quant Engine — Q0.3 Risk Evaluation Performance Baseline (N=${N})\n`);

time("evaluateRisk (basic entry, RISK_BASIC_BUY) x N", () => {
  for (let i = 0; i < N; i++) evaluateRisk(RISK_BASIC_BUY.input);
});

time("evaluateRisk (management, RISK_TRAILING) x N", () => {
  for (let i = 0; i < N; i++) evaluateRisk(RISK_TRAILING.input);
});

time("validateEntryGeometry x N", () => {
  for (let i = 0; i < N; i++) validateEntryGeometry("BUY", 100, 98, 104);
});

time("evaluateTrailingStop x N", () => {
  for (let i = 0; i < N; i++) evaluateTrailingStop(
    { activation: { mode: "absolute", value: 2 }, distance: { mode: "absolute", value: 1 } },
    "BUY",
    100,
    110,
    103,
    undefined,
  );
});

time("evaluateMaxSimultaneousPositions x N", () => {
  for (let i = 0; i < N; i++) evaluateMaxSimultaneousPositions({ sizing: { method: "fixed-lot", lots: 1 }, maxSimultaneousPositions: 3 }, 2);
});

time("evaluateDailyLossLimit x N", () => {
  for (let i = 0; i < N; i++) evaluateDailyLossLimit(
    { sizing: { method: "fixed-lot", lots: 1 }, dailyLossLimit: { mode: "fixed-amount", amount: 500 } },
    { realizedPnlToday: -100, equityAtDayStart: 10_000 },
  );
});
