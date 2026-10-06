// services/edge-analyzer/analysis/core.ts
// AT24 Trader Edge Analyzer (E1) - deterministic core numbers. Pure.
//
// IMPORTANT (verified against a real MT5 report): trades MUST be walked in
// CLOSE-time order to build the balance curve. Ordering by open time produced a
// 46% max drawdown where the terminal reports 61.91%; close-time order matches
// the terminal exactly. Balance operations (deposits/withdrawals) are applied at
// their own time.

import type { BalanceOp, ClosedTrade } from "../types";

export interface CoreStats {
  tradeCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / tradeCount (breakeven is NOT a win). */
  winRatePct: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  /** null when there are no losing trades (never Infinity). */
  profitFactor: number | null;
  /** Average net per trade. */
  expectancy: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** avgWin / |avgLoss|; null if undefined. */
  payoffRatio: number | null;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  startBalance: number;
  endBalance: number;
  maxDrawdownAbs: number;
  maxDrawdownPct: number;
  /** startBalance - lowest balance reached (0 if it never fell below start). */
  absoluteDrawdown: number;
  avgHoldMsWinners: number | null;
  avgHoldMsLosers: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function sortByCloseTime(trades: readonly ClosedTrade[]): ClosedTrade[] {
  return [...trades].sort((a, b) => a.closeTime - b.closeTime || a.openTime - b.openTime || a.positionId.localeCompare(b.positionId));
}

export function computeCoreStats(trades: readonly ClosedTrade[], startBalance: number, balanceOps: readonly BalanceOp[] = []): CoreStats {
  const ordered = sortByCloseTime(trades);
  // Profit/loss classification uses the platform Profit column, matching the
  // terminal's Results block; `net` (incl. commission/swap) drives the balance.
  let wins = 0, losses = 0, breakeven = 0, grossProfit = 0, grossLoss = 0;
  let largestWin = 0, largestLoss = 0, winStreak = 0, lossStreak = 0, maxW = 0, maxL = 0;
  let holdWin = 0, holdLoss = 0;
  let net = 0;
  for (const t of ordered) {
    net += t.net;
    if (t.profit > 0) {
      wins += 1; grossProfit += t.profit; holdWin += t.closeTime - t.openTime;
      largestWin = Math.max(largestWin, t.profit);
      winStreak += 1; lossStreak = 0; maxW = Math.max(maxW, winStreak);
    } else if (t.profit < 0) {
      losses += 1; grossLoss += t.profit; holdLoss += t.closeTime - t.openTime;
      largestLoss = Math.min(largestLoss, t.profit);
      lossStreak += 1; winStreak = 0; maxL = Math.max(maxL, lossStreak);
    } else {
      breakeven += 1; winStreak = 0; lossStreak = 0;
    }
  }

  // Balance curve: trades at close time, balance ops (after the initial deposit) at their time.
  const events: { time: number; delta: number }[] = ordered.map((t) => ({ time: t.closeTime, delta: t.net }));
  for (const op of balanceOps.slice(1)) events.push({ time: op.time, delta: op.amount });
  events.sort((a, b) => a.time - b.time);
  let balance = startBalance, peak = startBalance, minBalance = startBalance, maxDdAbs = 0, maxDdPct = 0;
  for (const e of events) {
    balance += e.delta;
    if (balance > peak) peak = balance;
    if (balance < minBalance) minBalance = balance;
    const dd = peak - balance;
    if (dd > maxDdAbs) maxDdAbs = dd;
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  }

  const n = ordered.length;
  const avgWin = wins > 0 ? grossProfit / wins : null;
  const avgLoss = losses > 0 ? grossLoss / losses : null;
  return {
    tradeCount: n,
    wins,
    losses,
    breakeven,
    winRatePct: n > 0 ? r2((wins / n) * 100) : 0,
    netProfit: r2(net),
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    profitFactor: grossLoss < 0 ? r2(grossProfit / Math.abs(grossLoss)) : null,
    expectancy: n > 0 ? r2(net / n) : 0,
    avgWin: avgWin === null ? null : r2(avgWin),
    avgLoss: avgLoss === null ? null : r2(avgLoss),
    payoffRatio: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? r2(avgWin / Math.abs(avgLoss)) : null,
    largestWin: r2(largestWin),
    largestLoss: r2(largestLoss),
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    startBalance: r2(startBalance),
    endBalance: r2(balance),
    maxDrawdownAbs: r2(maxDdAbs),
    maxDrawdownPct: r2(maxDdPct),
    absoluteDrawdown: r2(Math.max(0, startBalance - minBalance)),
    avgHoldMsWinners: wins > 0 ? Math.round(holdWin / wins) : null,
    avgHoldMsLosers: losses > 0 ? Math.round(holdLoss / losses) : null,
  };
}
