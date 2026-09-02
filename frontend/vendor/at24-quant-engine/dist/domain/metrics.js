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
