import type { SimulationTrade } from "../../domain/simulation/trade.js";
import type { Position } from "../../domain/position.js";
export interface RecordTradeInput {
    readonly tradeId: string;
    readonly strategyVersion: string;
    readonly position: Position;
    readonly exitPrice: number;
    readonly exitTimestamp: number;
    readonly quantity: number;
    readonly grossPnl: number;
    readonly fees: number;
    readonly fillModel: string;
    readonly spreadModel: string;
    readonly slippageModel: string;
    readonly feeModel: string;
    /** Only set when the caller genuinely knows why this position closed (P3.3) — never invented here. */
    readonly exitReason?: string;
}
/**
 * `rMultiple` reuses Q0.3's `computeRealizedR` (r-multiple.ts) — no
 * second R formula (Q0.5.24). It is `null`, never 0/NaN, when the
 * position carries no stopLoss (R is undefined without a risk distance;
 * `computeRealizedR` would throw in that case, so this function checks
 * for a stop first rather than swallowing the throw).
 *
 * Q0.10: R-multiple is computed from `initialStopLoss` (the stop AT ENTRY,
 * never moved) when present, falling back to `stopLoss` for a position
 * that never had management applied to it (or a hand-built Position
 * predating this field). Using the CURRENT `stopLoss` here would make the
 * "risk" shrink or invert the moment breakeven/trailing moves the stop
 * past entry — exactly the outcome those features are DESIGNED to
 * produce — turning a normal winning trade into a thrown error instead of
 * a well-defined (correctly large) R-multiple. See
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md.
 */
export declare function buildTrade(input: RecordTradeInput): SimulationTrade;
/**
 * Append-only, immutable ledger (Q0.5.23) — no update/remove method
 * exists at all. Every recorded Trade is frozen so any accidental
 * downstream mutation attempt throws rather than silently rewriting
 * history.
 */
export declare class TradeLedger {
    private readonly trades;
    record(trade: SimulationTrade): SimulationTrade;
    all(): readonly SimulationTrade[];
    size(): number;
}
