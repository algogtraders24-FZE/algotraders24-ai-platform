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
export function computeCoreMetrics(trades, initialEquity) {
    const tradeCount = trades.length;
    const netProfit = trades.reduce((sum, t) => sum + t.pnl, 0);
    const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const winRate = tradeCount === 0 ? 0 : (wins / tradeCount) * 100;
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / Math.abs(grossLoss);
    const averageTrade = tradeCount === 0 ? 0 : netProfit / tradeCount;
    const totalReturn = initialEquity === 0 ? 0 : (netProfit / initialEquity) * 100;
    let equity = initialEquity;
    let peak = initialEquity;
    let maxDrawdown = 0;
    for (const t of trades) {
        equity += t.pnl;
        if (equity > peak)
            peak = equity;
        const drawdown = peak === 0 ? 0 : ((peak - equity) / peak) * 100;
        if (drawdown > maxDrawdown)
            maxDrawdown = drawdown;
    }
    return {
        totalReturn,
        netProfit,
        grossProfit,
        grossLoss,
        profitFactor,
        winRate,
        expectancy: averageTrade,
        maxDrawdown,
        averageTrade,
        tradeCount,
    };
}
function sampleStdDev(values) {
    if (values.length < 2)
        return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
export function computeRiskRatios(trades, equityCurve, coreMetrics) {
    // Per-trade returns need the account's own equity immediately BEFORE
    // each trade, not after. equityCurve's own established convention
    // (deriveEquityCurve, services/algo-test/run-backtest.ts) is: point[0]
    // = initialBalance (before trade 0), point[i+1] = balance after trade
    // i (== balance before trade i+1) - so equityCurve[i] is exactly "the
    // balance before trade i", for every i, uniformly, with no special
    // case needed for the first trade.
    const tradeReturns = [];
    for (let i = 0; i < trades.length; i++) {
        const before = equityCurve[i]?.balance;
        if (before !== undefined && before !== 0)
            tradeReturns.push(trades[i].pnl / before);
    }
    const meanReturn = tradeReturns.length === 0 ? null : tradeReturns.reduce((s, v) => s + v, 0) / tradeReturns.length;
    const stdDev = sampleStdDev(tradeReturns);
    const sharpeRatio = meanReturn === null || tradeReturns.length < 2 || stdDev === 0 ? null : meanReturn / stdDev;
    const downsideDeviation = tradeReturns.length === 0 ? 0 : Math.sqrt(tradeReturns.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / tradeReturns.length);
    const sortinoRatio = meanReturn === null || tradeReturns.length < 2 || downsideDeviation === 0 ? null : meanReturn / downsideDeviation;
    const calmarRatio = coreMetrics.maxDrawdown === 0 ? null : coreMetrics.totalReturn / coreMetrics.maxDrawdown;
    let peak = equityCurve[0]?.balance ?? 0;
    let maxDrawdownCurrency = 0;
    const drawdownPercents = [];
    for (const point of equityCurve) {
        if (point.balance > peak)
            peak = point.balance;
        const ddCurrency = peak - point.balance;
        if (ddCurrency > maxDrawdownCurrency)
            maxDrawdownCurrency = ddCurrency;
        drawdownPercents.push(peak === 0 ? 0 : (ddCurrency / peak) * 100);
    }
    const recoveryFactor = maxDrawdownCurrency === 0 ? null : coreMetrics.netProfit / maxDrawdownCurrency;
    const ulcerIndex = equityCurve.length === 0 ? null : Math.sqrt(drawdownPercents.reduce((s, d) => s + d ** 2, 0) / drawdownPercents.length);
    return { sharpeRatio, sortinoRatio, calmarRatio, recoveryFactor, ulcerIndex };
}
