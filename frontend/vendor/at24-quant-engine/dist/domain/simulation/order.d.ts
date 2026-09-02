import type { Instrument } from "../market-data.js";
import type { OrderSide } from "../order-intent.js";
export type SimulationOrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
/**
 * Q0.12.21 — a pending order's own expiration policy, distinct from
 * Q0.7's `TimeInForce` (a strategy-authored INTENT vocabulary,
 * `domain/strategy-ir/order-ir.ts`, unused by this runtime type). `GTC`
 * never expires until the simulation itself ends (Q0.5's original,
 * only-ever-implemented behavior — absent `expiration` means `GTC`,
 * unchanged). `DAY` expires at the next trading-day boundary
 * (`computeTradingDayKey`, Q0.3, reused unmodified). `BAR` expires after
 * a fixed number of bars have elapsed since the order's OWN creation bar
 * (tracked in `SimulationState.orderCreationBarIndex`, never inferred
 * from a timestamp difference, since bar durations are not assumed
 * uniform). `TIMESTAMP` expires at an explicit, absolute instant. Any
 * source construct this package cannot map to one of these four stays
 * honestly unresolved at the IR/reduction layer — this type itself has
 * no `UNSUPPORTED` member because an unsupported policy is never allowed
 * to reach a real `SimulationOrder` in the first place.
 */
export type OrderExpirationPolicy = {
    readonly kind: "GTC";
} | {
    readonly kind: "DAY";
} | {
    readonly kind: "BAR";
    readonly maxBars: number;
} | {
    readonly kind: "TIMESTAMP";
    readonly expiresAt: number;
};
export type OrderStatus = "NEW" | "SUBMITTED" | "ACCEPTED" | "TRIGGERED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
/**
 * Order identity is deterministic within a simulation run:
 * `${strategyVersion}:${instrument.symbol}:${side}:${orderType}:${creationTimestamp}:${sequence}`
 * — never Date.now(), Math.random(), or a machine-generated UUID (Q0.5.6).
 *
 * Q0.12 CONTRACT CHANGE (additive, backward-compatible): added
 * `expiration` (absent means `GTC`, the original, only-ever-implemented
 * behavior — unchanged for every pre-Q0.12 order), `parentOrderId`, and
 * `replacementReason`. A REPLACE operation (Q0.12.17) never mutates an
 * existing order's identity — it cancels the old order and creates a
 * genuinely NEW `SimulationOrder` whose `parentOrderId` points back to
 * the cancelled one, with `replacementReason` recording why. See
 * docs/Q0.12_CANCEL_REPLACE.md.
 */
export interface SimulationOrder {
    readonly orderId: string;
    readonly strategyVersion: string;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly quantity: number;
    readonly orderType: SimulationOrderType;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
    /** Protective levels to attach to the resulting Position once this order fills (entry orders only). */
    readonly attachedStopLoss?: number;
    readonly attachedTakeProfit?: number;
    readonly creationTimestamp: number;
    readonly sequence: number;
    readonly status: OrderStatus;
    readonly filledQuantity: number;
    readonly averageFillPrice?: number;
    /** Populated only once a REJECTED/CANCELLED/EXPIRED transition occurs — a deterministic, structured reason, never left implicit. */
    readonly terminalReason?: string;
    readonly expiration?: OrderExpirationPolicy;
    readonly parentOrderId?: string;
    readonly replacementReason?: string;
}
