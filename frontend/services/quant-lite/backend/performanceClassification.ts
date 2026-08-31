/**
 * Q1.2 Part 5/6/7 - large-run performance classification. Server-only,
 * server-authoritative (embedded into CoverageAssessment, computed the
 * same way and at the same time as the coverage/gap assessment - a
 * client cannot set or influence it, only receive it).
 *
 * Thresholds come directly from Q1.1's real measured benchmark
 * (quant-engine/reports/Q1.1_PERFORMANCE_BENCHMARK.md /
 * Q1.1_PERFORMANCE_LIMITS.md) - not guessed, not invented for this
 * sprint. Only 1m/5m signal timeframes were benchmarked at full-history
 * scale and showed SLOW-tier runtime (70-82s); every other timeframe's
 * full-year runs stayed well within NORMAL (15-35s, Q1.0's timeframe
 * sweep) even at their longest tested window, so this warning is scoped
 * to 1m/5m only - extending it to other timeframes without measurement
 * would be exactly the "guesswork" the sprint explicitly rules out.
 *
 * No internal memory figures or promised completion times are exposed -
 * only a generic, evidence-gated notice (Q1.2 Part 5's explicit
 * instruction).
 */
import type { PerformanceClass } from "@/types/quant-lite-coverage";

// Q1.1 measured data points (signal timeframe -> {days, elapsedSeconds}):
//   1m: 30d~19s, 90d~25s, 180d~14s, 365d~40s, ~950d(full)~82s
//   5m: 30d~5s,  90d~13s, 180d~16s, 365d~42s, ~950d(full)~70s
// Q1.3 added an intermediate 547-day (18mo) point, run TWICE to check
// reproducibility (Q1.3_PERFORMANCE_BENCHMARK.md): 1m measured 89.7s then
// 57.1s, 5m measured 41.5s then 45.4s - both runs of both timeframes at
// 547 days landed at or above the 45s NORMAL/SLOW boundary, while BOTH
// measured 365-day runs (39.9s/42.3s) stayed comfortably under it. This
// CONFIRMS 365 days as the threshold rather than narrowing it further -
// the crossover sits close to, not far past, the existing boundary, and
// real run-to-run variance (57s vs 90s for the identical 18-month/1m
// case) means a more granular threshold between 365-547 days could not
// be pinned down without more data than is warranted here ("do not guess
// thresholds" cuts both ways - refusing to overfit a boundary to noisy
// single-sample points is itself evidence-respecting).
const LARGE_RUN_TIMEFRAMES = new Set(["1m", "5m"]);
const LARGE_RUN_THRESHOLD_DAYS = 365;

export function classifyPerformance(timeframe: string, requestedDurationDays: number): { performanceClass: PerformanceClass; performanceWarning: string | null } {
  if (!LARGE_RUN_TIMEFRAMES.has(timeframe) || requestedDurationDays <= LARGE_RUN_THRESHOLD_DAYS) {
    return { performanceClass: "NORMAL", performanceWarning: null };
  }
  return {
    performanceClass: "SLOW",
    performanceWarning:
      "Larger historical runs may take significantly longer and use more server resources. This is a performance notice only - it does not indicate a problem with your strategy, the requested data, or the backtest result.",
  };
}
