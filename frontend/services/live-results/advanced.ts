// services/live-results/advanced.ts
// AT24 Live Results - the "Advanced statistics" tabs (Hourly, Daily, Risk of ruin, Duration). Pure.
// Everything here is counts, percentages or probabilities; money only appears when the caller opts in
// (weekday net), so percent-only pages cannot leak amounts through these tabs.
// Times are the broker's server time (hour/day of ENTRY).

import type { BalanceOp, ClosedTrade } from "../edge-analyzer/types";
import { computeRuinAnalysis } from "../edge-analyzer/analysis/ruin";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const RUIN_LOSS_SIZES = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
export const DURATION_POINTS = 200;

export interface AdvancedStats {
  hourly: { hour: number; wins: number; losses: number }[];
  weekday: { day: string; trades: number; winRatePct: number | null; net?: number }[];
  ruin: {
    horizonTrades: number;
    rows: { lossPct: number; probIndependent: number; probStreak: number; consecutiveAvgLosses: number | null }[];
    longestLosingStreak: number;
  } | null;
  duration: { durationMs: number; gainPct: number; win: boolean }[];
}

/** Balance just before each trade closes (closed-trade balance, deposits/withdrawals at their own time). */
function balanceBeforeEach(trades: readonly ClosedTrade[], ops: readonly BalanceOp[]): Map<ClosedTrade, number> {
  type Ev = { time: number; delta: number; trade?: ClosedTrade };
  const ev: Ev[] = [
    ...ops.map((o): Ev => ({ time: o.time, delta: o.amount })),
    ...trades.map((t): Ev => ({ time: t.closeTime, delta: t.net, trade: t })),
  ].sort((a, b) => a.time - b.time || Number(b.trade === undefined) - Number(a.trade === undefined));
  const out = new Map<ClosedTrade, number>();
  let bal = 0;
  for (const e of ev) {
    if (e.trade) out.set(e.trade, bal);
    bal += e.delta;
  }
  return out;
}

export function computeAdvanced(
  trades: readonly ClosedTrade[],
  balanceOps: readonly BalanceOp[],
  endBalance: number,
  longestLosingStreak: number,
  withAmounts: boolean,
): AdvancedStats {
  // Hourly: winners vs losers by hour of entry.
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, wins: 0, losses: 0 }));
  for (const t of trades) {
    const h = new Date(t.openTime).getUTCHours();
    if (t.profit > 0) hourly[h].wins++;
    else if (t.profit < 0) hourly[h].losses++;
  }

  // Weekday (Mon..Sun) by day of entry.
  const wd = WEEKDAY_NAMES.map((day) => ({ day, trades: 0, wins: 0, net: 0 }));
  for (const t of trades) {
    const idx = (new Date(t.openTime).getUTCDay() + 6) % 7;
    wd[idx].trades++;
    if (t.profit > 0) wd[idx].wins++;
    wd[idx].net += t.net;
  }
  const weekday = wd.map((d) => {
    const row: AdvancedStats["weekday"][number] = { day: d.day, trades: d.trades, winRatePct: d.trades ? r2((d.wins / d.trades) * 100) : null };
    if (withAmounts) row.net = r2(d.net);
    return row;
  });

  // Duration scatter: growth % of each of the last N trades vs how long it was held.
  const before = balanceBeforeEach(trades, balanceOps);
  const lastN = [...trades].sort((a, b) => a.closeTime - b.closeTime).slice(-DURATION_POINTS);
  const duration = lastN.map((t) => {
    const b = before.get(t) ?? 0;
    return { durationMs: Math.max(0, t.closeTime - t.openTime), gainPct: b > 0 ? r2((t.net / b) * 100) : 0, win: t.profit > 0 };
  });

  // Risk of ruin: probability of a drawdown of X% over the next trades (seeded resampling of the page's own trades),
  // and how many average-sized losing trades in a row it would take to lose X% of the current balance.
  let ruin: AdvancedStats["ruin"] = null;
  const analysis = computeRuinAnalysis(trades, endBalance, { thresholdsPct: RUIN_LOSS_SIZES });
  if (analysis && endBalance > 0) {
    const losses = trades.filter((t) => t.net < 0).map((t) => -t.net);
    const avgLoss = losses.length ? losses.reduce((s, x) => s + x, 0) / losses.length : 0;
    const ind = analysis.scenarios.find((s) => s.name === "independent");
    const str = analysis.scenarios.find((s) => s.name === "streak-preserving");
    if (ind && str) {
      ruin = {
        horizonTrades: str.horizonTrades,
        longestLosingStreak,
        rows: RUIN_LOSS_SIZES.map((lossPct, i) => ({
          lossPct,
          probIndependent: ind.probDrawdownReaches[i].probability,
          probStreak: str.probDrawdownReaches[i].probability,
          consecutiveAvgLosses: avgLoss > 0 ? Math.ceil((lossPct / 100) * endBalance / avgLoss) : null,
        })),
      };
    }
  }

  return { hourly, weekday, ruin, duration };
}
