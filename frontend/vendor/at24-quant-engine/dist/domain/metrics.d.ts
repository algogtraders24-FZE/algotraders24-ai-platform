/**
 * Canonical metric names (Q0.2.14). The point of this file is not
 * statistical completeness — it's that "profitFactor" (or any other name
 * here) means exactly one thing everywhere it's used. Reserved names are
 * declared but not computed yet; adding a compute function for one later
 * must not change what the name means structurally.
 */
export type CoreMetricName = "totalReturn" | "netProfit" | "grossProfit" | "grossLoss" | "profitFactor" | "winRate" | "expectancy" | "maxDrawdown" | "averageTrade" | "tradeCount";
/** Declared, not computed in Q0.2 — reserving the names/shape for a future sprint. */
export type ReservedMetricName = "sharpeRatio" | "sortinoRatio" | "calmarRatio" | "recoveryFactor" | "ulcerIndex";
export type MetricSet = Partial<Record<CoreMetricName, number>> & Partial<Record<ReservedMetricName, number>>;
export interface SimpleTrade {
    readonly pnl: number;
}
/**
 * Formulas (all against a flat list of closed trades' realized P&L and a
 * starting equity):
 *
 * tradeCount    = trades.length
 * netProfit     = sum(pnl)
 * grossProfit   = sum(pnl where pnl > 0)
 * grossLoss     = sum(pnl where pnl < 0)          [negative or zero]
 * winRate       = 100 * count(pnl > 0) / tradeCount   (0 if tradeCount = 0)
 * profitFactor  = grossProfit / abs(grossLoss)
 *                 grossLoss = 0 and grossProfit > 0 -> Infinity (no losing trades)
 *                 grossLoss = 0 and grossProfit = 0 -> 0 (no trades at all)
 * averageTrade  = netProfit / tradeCount            (0 if tradeCount = 0)
 * expectancy    = averageTrade                      (mathematically identical
 *                 for a flat per-trade-pnl trade list: winRate*avgWin +
 *                 lossRate*avgLoss reduces to the same value as the
 *                 simple mean of all pnl)
 * totalReturn   = 100 * netProfit / initialEquity   (0 if initialEquity = 0)
 * maxDrawdown   = max over the equity curve (built by applying trades in
 *                 order to initialEquity) of 100 * (peakSoFar - equity) / peakSoFar
 */
export declare function computeCoreMetrics(trades: readonly SimpleTrade[], initialEquity: number): Record<CoreMetricName, number>;
