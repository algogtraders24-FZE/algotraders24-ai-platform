/**
 * Q0.6.32-35 — compares two MultiFidelitySimulationResults produced from
 * the SAME bars/strategySpec/config (differing only in fidelity). Trades
 * are matched positionally: under NETTING, a finer fidelity can only
 * refine WHEN/AT-WHAT-PRICE an existing trade happened, never conjure an
 * unrelated trade ahead of another — index i of one ledger corresponds
 * to index i of the other for as long as both ledgers have that index.
 */
export function compareFidelities(baseline, compared) {
    if (baseline.resultHash === compared.resultHash) {
        return {
            baselineFidelity: baseline.provenance.simulationFidelity,
            comparedFidelity: compared.provenance.simulationFidelity,
            baselineResultHash: baseline.resultHash,
            comparedResultHash: compared.resultHash,
            identical: true,
            baselineTradeCount: baseline.tradeLedger.length,
            comparedTradeCount: compared.tradeLedger.length,
            netPnlDelta: 0,
            matchedTrades: [],
            unmatchedBaselineTradeIds: [],
            unmatchedComparedTradeIds: [],
            differenceClassification: "IDENTICAL",
        };
    }
    const matchCount = Math.min(baseline.tradeLedger.length, compared.tradeLedger.length);
    const matchedTrades = [];
    let priceDiffers = false;
    let timingDiffers = false;
    for (let i = 0; i < matchCount; i++) {
        const b = baseline.tradeLedger[i];
        const c = compared.tradeLedger[i];
        const priceDelta = c.exitPrice - b.exitPrice + (c.entryPrice - b.entryPrice);
        const timingDelta = c.exitTimestamp - b.exitTimestamp + (c.entryTimestamp - b.entryTimestamp);
        if (c.entryPrice !== b.entryPrice || c.exitPrice !== b.exitPrice)
            priceDiffers = true;
        if (c.entryTimestamp !== b.entryTimestamp || c.exitTimestamp !== b.exitTimestamp)
            timingDiffers = true;
        matchedTrades.push({ baselineTradeId: b.tradeId, comparedTradeId: c.tradeId, priceDelta, timingDelta });
    }
    const unmatchedBaselineTradeIds = baseline.tradeLedger.slice(matchCount).map((t) => t.tradeId);
    const unmatchedComparedTradeIds = compared.tradeLedger.slice(matchCount).map((t) => t.tradeId);
    const structural = baseline.tradeLedger.length !== compared.tradeLedger.length;
    let differenceClassification;
    if (structural)
        differenceClassification = "STRUCTURAL";
    else if (priceDiffers && timingDiffers)
        differenceClassification = "PRICE_AND_TIMING";
    else if (priceDiffers)
        differenceClassification = "PRICE_ONLY";
    else if (timingDiffers)
        differenceClassification = "TIMING_ONLY";
    else
        differenceClassification = "IDENTICAL"; // trades identical but some other field (e.g. provenance) differed
    const comparedNet = compared.tradeLedger.reduce((s, t) => s + t.netPnl, 0);
    const baselineNet = baseline.tradeLedger.reduce((s, t) => s + t.netPnl, 0);
    return {
        baselineFidelity: baseline.provenance.simulationFidelity,
        comparedFidelity: compared.provenance.simulationFidelity,
        baselineResultHash: baseline.resultHash,
        comparedResultHash: compared.resultHash,
        identical: false,
        baselineTradeCount: baseline.tradeLedger.length,
        comparedTradeCount: compared.tradeLedger.length,
        netPnlDelta: comparedNet - baselineNet,
        matchedTrades,
        unmatchedBaselineTradeIds,
        unmatchedComparedTradeIds,
        differenceClassification,
    };
}
