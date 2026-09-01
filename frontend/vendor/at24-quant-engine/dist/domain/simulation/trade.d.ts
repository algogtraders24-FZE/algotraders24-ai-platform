import type { Instrument } from "../market-data.js";
import type { OrderSide } from "../order-intent.js";
export interface TradeExecutionMetadata {
    readonly fillModel: string;
    readonly spreadModel: string;
    readonly slippageModel: string;
    readonly feeModel: string;
}
/**
 * An immutable, append-only ledger record (Q0.5.23) — never rewritten
 * once created (enforced by TradeLedger.record() freezing it, and by
 * TradeLedger never exposing an update/remove operation at all).
 * `rMultiple` is `null` (not 0/NaN) when the position had no stop-loss,
 * since R is undefined without a risk distance to divide by (Q0.3's
 * `computeRealizedR` throws in that case — this ledger records the
 * absence explicitly rather than swallowing the throw into a fake 0).
 *
 * Named `SimulationTrade`, not `Trade`: Q0's `domain/backtest-result.ts`
 * already reserves the name `Trade` for a thin, never-implemented
 * placeholder shape (`{ position, pnl, rMultiple? }`) as part of the
 * still-contract-only `BacktestResult`. This is the first REAL,
 * populated trade record Q0.5 actually produces — kept a distinct type
 * rather than colliding with or silently repurposing that placeholder.
 */
export interface SimulationTrade {
    readonly tradeId: string;
    readonly strategyVersion: string;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly entryPrice: number;
    readonly entryTimestamp: number;
    readonly exitPrice: number;
    readonly exitTimestamp: number;
    readonly quantity: number;
    readonly grossPnl: number;
    readonly fees: number;
    readonly netPnl: number;
    readonly rMultiple: number | null;
    readonly executionMetadata: TradeExecutionMetadata;
}
