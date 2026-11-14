// services/edge-analyzer/analysis/prop-checks.ts
// AT24 Trader Edge Analyzer - "rule-style checks": the measurements a prop firm's rulebook is usually written around, computed from the
// trader's CLOSED trades. Pure and deterministic, like the rest of the analyzer.
//
// What this is NOT: a verdict, a pass/fail, or a statement of any firm's rules. Firms set their own thresholds (and some do not use these
// rules at all), so every figure is a plain measurement the reader compares with the rules that apply to them. Times are broker server time
// read as if UTC (see types.ts), so "day" means broker day.

import type { ClosedTrade } from "../types";

export interface ConsistencyCheck {
  /** Sum of net profit over all trades (can be negative). */
  totalNet: number;
  /** Broker days with at least one closed trade. */
  tradingDays: number;
  profitableDays: number;
  losingDays: number;
  bestDayNet: number | null;
  bestDayDate: string | null;
  /** Best day's net as a percent of total net profit. Null unless both are positive (the ratio means nothing otherwise). */
  bestDaySharePct: number | null;
  /** The three best days together, same basis. Null unless total net is positive. */
  top3DaysSharePct: number | null;
}

export interface StopLossCheck {
  withStopLoss: number;
  withoutStopLoss: number;
  withoutPct: number;
}

export interface OverlapCheck {
  /** Most positions open at the same moment on one symbol (the trade being opened counts). */
  maxOpenOnOneSymbol: number;
  /** Percent of trades opened while another position in the SAME direction on the same symbol was open (adding, averaging, grids). */
  openedWhileSameDirectionOpenPct: number;
  /** Percent of trades opened while a position in the OPPOSITE direction on the same symbol was open (hedging). */
  openedWhileOppositeDirectionOpenPct: number;
}

export interface HoldingCheck {
  under1MinutePct: number;
  under5MinutesPct: number;
  medianHoldMs: number | null;
}

export interface PropChecks {
  tradeCount: number;
  consistency: ConsistencyCheck;
  stopLoss: StopLossCheck;
  overlap: OverlapCheck;
  holding: HoldingCheck;
  /** Plain statements the report must show next to the numbers. */
  notes: string[];
}

export const PROP_CHECK_NOTES: readonly string[] = [
  "These are measurements of your closed trades, not a pass/fail and not any firm's official check. Every firm sets its own rules and thresholds.",
  "Compare each figure with the written rules that apply to you; this report does not know them.",
  "Days are broker-server days. Floating (open) positions are not included.",
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? r2((part / whole) * 100) : 0);
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function computeConsistency(trades: readonly ClosedTrade[]): ConsistencyCheck {
  const byDay = new Map<string, number>();
  let totalNet = 0;
  for (const t of trades) {
    const d = dayOf(t.closeTime);
    byDay.set(d, (byDay.get(d) ?? 0) + t.net);
    totalNet += t.net;
  }
  const days = [...byDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const best = days[0];
  const profitableDays = days.filter(([, n]) => n > 0).length;
  const losingDays = days.filter(([, n]) => n < 0).length;
  const positiveTotal = totalNet > 0;
  const bestDayNet = best ? r2(best[1]) : null;
  const top3 = days.slice(0, 3).reduce((s, [, n]) => s + n, 0);
  return {
    totalNet: r2(totalNet),
    tradingDays: days.length,
    profitableDays,
    losingDays,
    bestDayNet,
    bestDayDate: best ? best[0] : null,
    bestDaySharePct: best && positiveTotal && best[1] > 0 ? r2((best[1] / totalNet) * 100) : null,
    top3DaysSharePct: positiveTotal ? r2((top3 / totalNet) * 100) : null,
  };
}

export function computeStopLossUse(trades: readonly ClosedTrade[]): StopLossCheck {
  const without = trades.filter((t) => t.stopLoss === null || t.stopLoss === 0).length;
  return { withStopLoss: trades.length - without, withoutStopLoss: without, withoutPct: pct(without, trades.length) };
}

export function computeOverlap(trades: readonly ClosedTrade[]): OverlapCheck {
  const bySymbol = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }
  let maxOpen = trades.length > 0 ? 1 : 0;
  let sameDir = 0;
  let oppositeDir = 0;
  for (const list of bySymbol.values()) {
    list.sort((a, b) => a.openTime - b.openTime || a.closeTime - b.closeTime);
    let active: ClosedTrade[] = [];
    for (const t of list) {
      active = active.filter((o) => o.closeTime > t.openTime);
      if (active.some((o) => o.direction === t.direction)) sameDir++;
      if (active.some((o) => o.direction !== t.direction)) oppositeDir++;
      if (active.length + 1 > maxOpen) maxOpen = active.length + 1;
      active.push(t);
    }
  }
  return { maxOpenOnOneSymbol: maxOpen, openedWhileSameDirectionOpenPct: pct(sameDir, trades.length), openedWhileOppositeDirectionOpenPct: pct(oppositeDir, trades.length) };
}

export function computeHolding(trades: readonly ClosedTrade[]): HoldingCheck {
  const holds = trades.map((t) => Math.max(0, t.closeTime - t.openTime)).sort((a, b) => a - b);
  return {
    under1MinutePct: pct(holds.filter((h) => h < 60_000).length, holds.length),
    under5MinutesPct: pct(holds.filter((h) => h < 300_000).length, holds.length),
    medianHoldMs: median(holds),
  };
}

export function computePropChecks(trades: readonly ClosedTrade[]): PropChecks {
  return {
    tradeCount: trades.length,
    consistency: computeConsistency(trades),
    stopLoss: computeStopLossUse(trades),
    overlap: computeOverlap(trades),
    holding: computeHolding(trades),
    notes: [...PROP_CHECK_NOTES],
  };
}
