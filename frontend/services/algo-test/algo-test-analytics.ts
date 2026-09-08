// services/algo-test/algo-test-analytics.ts
// P4.4 (docs/P4.4-ADVANCED-ANALYTICS-FOUNDATION.md) - Tier 1: pure,
// deterministic projections over an already-completed run's own
// AlgoTestTradeView[]/AlgoTestEquityPoint[] - never a strategy-specific
// branch, never a new execution/simulation concept, never a mutation of
// the trades/equity arrays passed in. `buildAnalyticsView()` is the ONE
// entry point algo-test.service.ts calls for every strategy source (P4.3's
// own "one function serves every source" discipline, applied here too),
// on both a fresh run and a reopen - see AlgoTestRunView.analytics's own
// doc comment for why reopen works here but not for lifecycle/
// compiledStrategy/strategyHash.
import type { AlgoTestCalendarDayEntry, AlgoTestDurationPnlPoint, AlgoTestPnlBucket, AlgoTestPnlDistributionView, AlgoTestRiskRatiosView, AlgoTestSideBreakdownEntry, AlgoTestSideBreakdownView, AlgoTestTradeView } from "@/types/algo-test";

const MAX_BUCKETS = 10;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Equal-width buckets spanning [min(pnl), max(pnl)] across every trade
 * (winners and losers together - a P&L distribution is one histogram,
 * not two). `min(10, tradeCount)` buckets, never more than there are
 * trades to spread across; a single distinct P&L value across every
 * trade (including the single-trade case) produces exactly ONE bucket
 * covering that value, avoiding a zero-width-bucket division.
 */
function buildBuckets(pnls: readonly number[]): AlgoTestPnlBucket[] {
  if (pnls.length === 0) return [];
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  if (min === max) return [{ rangeStart: min, rangeEnd: max, count: pnls.length }];

  const bucketCount = Math.min(MAX_BUCKETS, pnls.length);
  const width = (max - min) / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);
  for (const p of pnls) {
    // The maximum value belongs to the LAST bucket (inclusive upper
    // bound there only), matching a standard half-open-interval
    // histogram - without this, `p === max` would compute index
    // `bucketCount` (out of range).
    const idx = p === max ? bucketCount - 1 : Math.min(bucketCount - 1, Math.floor((p - min) / width));
    counts[idx] += 1;
  }
  return counts.map((count, i) => ({
    rangeStart: min + i * width,
    rangeEnd: i === bucketCount - 1 ? max : min + (i + 1) * width,
    count,
  }));
}

export function buildPnlDistribution(trades: readonly AlgoTestTradeView[]): AlgoTestPnlDistributionView {
  const wins = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losses = trades.filter((t) => t.pnl < 0).map((t) => t.pnl);
  return {
    winCount: wins.length,
    lossCount: losses.length,
    winSum: wins.reduce((s, v) => s + v, 0),
    lossSum: losses.reduce((s, v) => s + v, 0),
    winAverage: average(wins),
    lossAverage: average(losses),
    winMedian: median(wins),
    lossMedian: median(losses),
    buckets: buildBuckets(trades.map((t) => t.pnl)),
  };
}

function buildSideEntry(side: "BUY" | "SELL", trades: readonly AlgoTestTradeView[]): AlgoTestSideBreakdownEntry {
  const sideTrades = trades.filter((t) => t.side === side);
  const wins = sideTrades.filter((t) => t.pnl > 0).length;
  const netPnl = sideTrades.reduce((s, t) => s + t.pnl, 0);
  return {
    side,
    tradeCount: sideTrades.length,
    winRate: sideTrades.length === 0 ? 0 : (wins / sideTrades.length) * 100,
    netPnl,
    averagePnl: sideTrades.length === 0 ? null : netPnl / sideTrades.length,
  };
}

export function buildSideBreakdown(trades: readonly AlgoTestTradeView[]): AlgoTestSideBreakdownView {
  return { buy: buildSideEntry("BUY", trades), sell: buildSideEntry("SELL", trades) };
}

export function buildDurationVsPnl(trades: readonly AlgoTestTradeView[]): AlgoTestDurationPnlPoint[] {
  return trades.map((t) => ({ tradeId: t.tradeId, durationMs: t.exitTime - t.entryTime, pnl: t.pnl, side: t.side }));
}

/**
 * Groups by the UTC calendar date of each trade's own EXIT (the moment
 * its P&L became real), never entry - matching how every other
 * date-bucketed view in this codebase (equity curve points, the trade
 * log itself) already anchors on exit. Deliberately does NOT fabricate
 * an entry for a day with zero trades - doing so would require inventing
 * a date range to fill (this run's own start/end, a rolling window,
 * something else?), which is exactly the kind of invented policy this
 * phase's own hard constraints rule out. A calendar-grid UI treats any
 * date absent from this array as its own real "zero-trade day" state.
 */
export function buildCalendar(trades: readonly AlgoTestTradeView[]): AlgoTestCalendarDayEntry[] {
  const byDate = new Map<string, { count: number; netPnl: number }>();
  for (const t of trades) {
    const date = new Date(t.exitTime).toISOString().slice(0, 10);
    const existing = byDate.get(date) ?? { count: 0, netPnl: 0 };
    byDate.set(date, { count: existing.count + 1, netPnl: existing.netPnl + t.pnl });
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { count, netPnl }]) => ({
      date,
      tradeCount: count,
      netPnl,
      outcome: netPnl > 0 ? "winning" : netPnl < 0 ? "losing" : "breakeven",
    }));
}

/**
 * P4.4 Tier 2 wire projection - the real formulas/edge-case handling live
 * in at24-quant-engine's computeRiskRatios() (metrics.ts); this function
 * only re-shapes that already-computed, already-typed result into the
 * wire view (same "types/ never imports services/" boundary every other
 * view in this file respects) - never a second, parallel implementation
 * of the formulas themselves.
 */
export function toRiskRatiosView(ratios: {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  recoveryFactor: number | null;
  ulcerIndex: number | null;
}): AlgoTestRiskRatiosView {
  return { ...ratios };
}
