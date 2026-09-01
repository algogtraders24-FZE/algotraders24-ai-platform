import type { SimulationFidelity } from "./simulation-fidelity.js";
/**
 * Q0.6.35 — a coarse, deterministic bucket for what actually differed
 * between two fidelity runs over the same bars/strategy/config:
 * - IDENTICAL: resultHash matched — no difference at all.
 * - PRICE_ONLY: same trade count/order, at least one fill/exit price differs, no timestamp differs.
 * - TIMING_ONLY: same trade count/order, at least one entry/exit timestamp differs, no price differs.
 * - PRICE_AND_TIMING: same trade count/order, both price and timestamp differences exist.
 * - STRUCTURAL: trade COUNT differs — the finer fidelity changed WHICH trades occurred, not just their details.
 */
export type FidelityDifferenceClassification = "IDENTICAL" | "PRICE_ONLY" | "TIMING_ONLY" | "PRICE_AND_TIMING" | "STRUCTURAL";
export interface TradeMatch {
    readonly baselineTradeId: string;
    readonly comparedTradeId: string;
    readonly priceDelta: number;
    readonly timingDelta: number;
}
/**
 * Q0.6.32-35 — the result of comparing two SimulationResults (typically
 * D1 vs D2, or D2 vs D3) produced from the SAME bars/strategySpec/config.
 * Trades are matched POSITIONALLY (index i of one ledger against index i
 * of the other) — correct under NETTING's single-position-per-instrument
 * model, where a finer fidelity can only ever refine WHEN/AT-WHAT-PRICE a
 * trade happened, never reorder unrelated trades ahead of each other.
 */
export interface FidelityComparison {
    readonly baselineFidelity: SimulationFidelity;
    readonly comparedFidelity: SimulationFidelity;
    readonly baselineResultHash: string;
    readonly comparedResultHash: string;
    readonly identical: boolean;
    readonly baselineTradeCount: number;
    readonly comparedTradeCount: number;
    readonly netPnlDelta: number;
    readonly matchedTrades: readonly TradeMatch[];
    readonly unmatchedBaselineTradeIds: readonly string[];
    readonly unmatchedComparedTradeIds: readonly string[];
    readonly differenceClassification: FidelityDifferenceClassification;
}
