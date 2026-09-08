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
