import type { Instrument } from "../../domain/market-data.js";
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
