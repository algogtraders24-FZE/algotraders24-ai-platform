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
/**
 * P4.4 - fills the ReservedMetricName slot this file declared, unused,
 * since Q0.2. A completely SEPARATE function from computeCoreMetrics
 * (never merged into it, never called from simulation-engine.ts's own
 * runSimulation() call site) - a deliberate boundary: this is pure,
 * additive, post-hoc analysis over an ALREADY-PRODUCED trade list/equity
 * curve, not a change to what runSimulation() itself computes or returns.
 *
 * Every ratio here is PER-TRADE, not annualized: trades are not evenly
 * time-spaced (a backtest's own trade cadence, not a fixed daily/weekly
 * bar count), so "annualizing" would require inventing a trades-per-year
 * factor this function does not invent. Every ratio assumes a 0
 * risk-free rate - a disclosed assumption, the same "declare it, never
 * claim realism" convention this program already uses for
 * ZeroSpread/ZeroSlippage/ZeroFee. `null` (never a fabricated 0) means
 * the ratio is genuinely mathematically undefined for this input, not
 * merely "worked out to zero."
 *
 * Formulas:
 *
 * tradeReturn[i]   = trade[i].pnl / equityBeforeTrade[i]     (a per-trade
 *                    percentage return, since this program has no fixed-
 *                    period equity samples - only one equity point per
 *                    closed trade)
 * sharpeRatio      = mean(tradeReturn) / sampleStdDev(tradeReturn)
 *                    null if fewer than 2 trades, or sampleStdDev = 0
 *                    (a single repeated return has no variance to divide
 *                    by)
 * sortinoRatio     = mean(tradeReturn) / downsideDeviation
 *                    downsideDeviation = sqrt(mean(min(tradeReturn[i],0)^2))
 *                    over EVERY trade (the standard definition - a
 *                    winning trade contributes 0, not excluded)
 *                    null if fewer than 2 trades, or downsideDeviation = 0
 *                    (no trade ever went negative - Sortino is undefined,
 *                    not infinite)
 * calmarRatio      = totalReturn(%) / maxDrawdown(%)         (both already
 *                    percentage-denominated on CoreMetricName - see this
 *                    file's own computeCoreMetrics doc comment)
 *                    null if maxDrawdown = 0
 * recoveryFactor   = netProfit (currency) / maxDrawdownCurrency
 *                    maxDrawdownCurrency is walked independently from the
 *                    equity curve (currency units, NOT the % maxDrawdown
 *                    Calmar uses - a currency/currency ratio is a
 *                    genuinely different number from a %/% one)
 *                    null if maxDrawdownCurrency = 0
 * ulcerIndex       = sqrt(mean(drawdownPercent[i]^2)) over EVERY equity
 *                    curve point (not just the single worst one
 *                    maxDrawdown uses) - the standard Ulcer Index
 *                    definition, rewarding a smooth equity curve over one
 *                    with the same maxDrawdown but many deep dips
 *                    null if the equity curve has fewer than 1 point
 */
export interface RiskRatios {
    readonly sharpeRatio: number | null;
    readonly sortinoRatio: number | null;
    readonly calmarRatio: number | null;
    readonly recoveryFactor: number | null;
    readonly ulcerIndex: number | null;
}
export interface EquityPoint {
    readonly balance: number;
}
export declare function computeRiskRatios(trades: readonly SimpleTrade[], equityCurve: readonly EquityPoint[], coreMetrics: Pick<Record<CoreMetricName, number>, "totalReturn" | "maxDrawdown" | "netProfit">): RiskRatios;
