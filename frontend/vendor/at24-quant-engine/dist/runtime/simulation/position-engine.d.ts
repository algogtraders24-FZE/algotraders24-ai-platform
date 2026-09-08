import type { Instrument, OHLCVBar } from "../../domain/market-data.js";
import type { OrderSide } from "../../domain/order-intent.js";
import type { Position } from "../../domain/position.js";
/**
 * Pure functions only — every operation returns a NEW Position, never
 * mutates the input (Q0.5.18/38). NETTING mode only (Q0.5.19; see
 * docs/Q0.5_POSITION_ACCOUNT.md for the rationale) — the caller
 * (position-accounting.ts / the orchestrator) is responsible for
 * deciding whether an opposite-direction order reduces/closes the
 * existing position first, per netting semantics; this module just
 * implements the individual open/increase/reduce/close primitives.
 * All realized P&L returned here is GROSS (before fees) — fees are
 * tracked and netted out separately (see account-engine.ts / Trade),
 * matching the gross/fees/net split Q0.5.23's Trade Ledger requires.
 */
export interface OpenPositionInput {
    readonly id: string;
    readonly originatingOrderIntentId: string;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly quantity: number;
    readonly entryPrice: number;
    readonly entryTimestamp: number;
    readonly stopLoss?: number;
    readonly takeProfit?: number;
    readonly fee: number;
}
export declare function openPosition(input: OpenPositionInput): Position;
/** Scale-in: adds quantity at a new price, recomputing the volume-weighted average entry price. */
export declare function increasePosition(position: Position, addQuantity: number, addPrice: number, timestamp: number, fee: number): Position;
export interface ReduceOutcome {
    readonly position: Position;
    readonly grossPnl: number;
}
/** Scale-out / partial close. Validates 0 < reduceQuantity <= current quantity (Q0.5.20). */
export declare function reducePosition(position: Position, reduceQuantity: number, exitPrice: number, timestamp: number, fee: number): ReduceOutcome;
export declare function closePosition(position: Position, exitPrice: number, timestamp: number, fee: number): ReduceOutcome;
export declare function computeUnrealizedPnl(position: Position, currentPrice: number): number;
/**
 * P4.6 (docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md) — folds ONE bar's
 * high/low into a position's running, side-agnostic price extremes.
 * Pure and strictly incremental: reads only `bar` (the CURRENT bar being
 * processed) and the position's own prior running state — never a slice
 * of `bars`, never any bar other than the one passed in. This is what
 * keeps the tracking lookahead-safe: simulation-engine.ts calls this
 * exactly once per bar, for whichever position is open at that point in
 * that bar's own processing, in the SAME strict bar-by-bar order the
 * rest of the engine already guarantees.
 *
 * Side-agnostic on purpose — this function has no notion of "favorable"
 * vs "adverse" (that depends on BUY vs SELL, applied only once, at
 * trade-build time in trade-ledger.ts). It only ever asks "is this bar's
 * high/low a new extreme," symmetrically for both directions.
 */
export declare function updateExcursion(position: Position, bar: OHLCVBar): Position;
