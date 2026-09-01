import type { Decision } from "./decision.js";
import type { Instrument } from "./market-data.js";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
/**
 * OrderIntent is what the strategy WANTS executed — not a confirmed fill.
 * Order != Position (see Q0.5): whether/how this becomes a Position is a
 * matter for a future execution layer, out of scope for Q0.
 */
export interface OrderIntent {
    readonly id: string;
    readonly decision: Decision;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly orderType: OrderType;
    readonly quantity: number;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
    readonly stopLoss?: number;
    readonly takeProfit?: number;
    readonly createdAt: number;
}
