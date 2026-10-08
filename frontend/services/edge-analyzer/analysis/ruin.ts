// services/edge-analyzer/analysis/ruin.ts
// AT24 Trader Edge Analyzer (E2) - Monte-Carlo "what could happen next" view.
//
// Resamples the user's OWN past per-trade net results (seeded, reproducible) and
// replays them over a future horizon to show the SPREAD of outcomes: how likely a
// deep drawdown is, and where the final balance could land.
//
// Two scenarios, because a plain shuffle hides streaks:
//   - "independent": every trade drawn separately (classic bootstrap);
//   - "streak-preserving": draws blocks of 10 consecutive trades, keeping runs of
//     wins/losses together. Real losing streaks are usually longer than the
//     independent scenario suggests, so this one is the more cautious read.
// Assumptions are disclosed to the user: fixed P&L amounts (no compounding),
// future trades look like past trades, no change in behavior or market regime.
// This is a risk illustration, never a forecast.

import type { ClosedTrade } from "../types";
import { sortByCloseTime } from "./core";
import { DEFAULT_SEED, mulberry32, percentile } from "./rng";

export const MIN_TRADES_FOR_RUIN = 30;
export const RUIN_BLOCK_LENGTH = 10;
export const DRAWDOWN_THRESHOLDS_PCT = [20, 30, 50] as const;

export interface RuinScenario {
  name: "independent" | "streak-preserving";
  blockLength: number;
  paths: number;
  horizonTrades: number;
  /** P(max drawdown from the running peak ever reaches the threshold during the horizon). */
  probDrawdownReaches: { thresholdPct: number; probability: number }[];
  /** P(balance ends below where it started the horizon). */
  probFinishBelowStart: number;
  /** P(balance ever falls to 50% of the starting balance); null if start balance <= 0. */
  probLoseHalfOfStart: number | null;
  finalBalancePercentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  medianMaxDrawdownPct: number;
}

export interface RuinAnalysis {
  startBalance: number;
  scenarios: RuinScenario[];
  assumptions: string[];
  seed: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function pathsFor(horizon: number): number {
  return Math.min(2000, Math.max(500, Math.floor(2e6 / Math.max(1, horizon))));
}

function simulate(
  pnl: Float64Array,
  start: number,
  horizon: number,
  paths: number,
  blockLength: number,
  seed: number,
  name: RuinScenario["name"],
  thresholds: readonly number[] = DRAWDOWN_THRESHOLDS_PCT,
): RuinScenario {
  const n = pnl.length;
  const rand = mulberry32(seed);
  const finals = new Float64Array(paths);
  const maxDds = new Float64Array(paths);
  const reach = thresholds.map(() => 0);
  let below = 0;
  let half = 0;
  for (let p = 0; p < paths; p++) {
    let bal = start, peak = start, maxDd = 0, hitHalf = false;
    let t = 0;
    while (t < horizon) {
      const startIdx = (rand() * n) | 0;
      const len = Math.min(blockLength, horizon - t);
      for (let k = 0; k < len; k++, t++) {
        bal += pnl[(startIdx + k) % n]!;
        if (bal > peak) peak = bal;
        if (peak > 0) {
          const dd = ((peak - bal) / peak) * 100;
          if (dd > maxDd) maxDd = dd;
        }
        if (start > 0 && bal <= start * 0.5) hitHalf = true;
      }
    }
    finals[p] = bal;
    maxDds[p] = maxDd;
    if (bal < start) below += 1;
    if (hitHalf) half += 1;
    for (let i = 0; i < thresholds.length; i++) if (maxDd >= thresholds[i]!) reach[i] = reach[i]! + 1;
  }
  finals.sort();
  maxDds.sort();
  return {
    name,
    blockLength,
    paths,
    horizonTrades: horizon,
    probDrawdownReaches: thresholds.map((th, i) => ({ thresholdPct: th, probability: r3(reach[i]! / paths) })),
    probFinishBelowStart: r3(below / paths),
    probLoseHalfOfStart: start > 0 ? r3(half / paths) : null,
    finalBalancePercentiles: {
      p5: r2(percentile(finals, 5)),
      p25: r2(percentile(finals, 25)),
      p50: r2(percentile(finals, 50)),
      p75: r2(percentile(finals, 75)),
      p95: r2(percentile(finals, 95)),
    },
    medianMaxDrawdownPct: r2(percentile(maxDds, 50)),
  };
}

/** @param startBalance the balance the simulated future starts from (typically the report's end balance). */
export function computeRuinAnalysis(
  trades: readonly ClosedTrade[],
  startBalance: number,
  opts: { seed?: number; horizonTrades?: number; thresholdsPct?: readonly number[] } = {},
): RuinAnalysis | null {
  if (trades.length < MIN_TRADES_FOR_RUIN) return null;
  const seed = opts.seed ?? DEFAULT_SEED;
  const ordered = sortByCloseTime(trades);
  const pnl = Float64Array.from(ordered, (t) => t.net);
  const horizon = Math.max(10, Math.min(opts.horizonTrades ?? Math.min(trades.length, 1000), 2000));
  const paths = pathsFor(horizon);
  return {
    startBalance: r2(startBalance),
    scenarios: [
      simulate(pnl, startBalance, horizon, paths, 1, seed, "independent", opts.thresholdsPct ?? DRAWDOWN_THRESHOLDS_PCT),
      simulate(pnl, startBalance, horizon, paths, RUIN_BLOCK_LENGTH, seed + 7, "streak-preserving", opts.thresholdsPct ?? DRAWDOWN_THRESHOLDS_PCT),
    ],
    assumptions: [
      "Resamples your own past trade results; future trades are assumed to look like past ones (same strategies, sizing and market conditions).",
      "Uses fixed profit/loss amounts: no compounding and no change in position size as the balance moves.",
      "The streak-preserving scenario keeps blocks of 10 consecutive trades together to reflect winning/losing runs; it is the more cautious reading.",
      "A risk illustration, not a forecast. Real outcomes can be better or worse.",
    ],
    seed,
  };
}
