import type { Instrument } from "../../domain/market-data.js";
import type { OrderSide } from "../../domain/order-intent.js";
import type { OrderStatus, SimulationOrder, SimulationOrderType, OrderExpirationPolicy } from "../../domain/simulation/order.js";
/**
 * The Q0.4-frozen lifecycle (docs/Q0.4_EVENT_MODEL.md), reused verbatim.
 * Terminal states (FILLED/CANCELLED/EXPIRED/REJECTED) have no outgoing
 * transitions at all.
 */
declare const VALID_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>>;
/**
 * Q0.12 CONTRACT CHANGE (additive, backward-compatible): added
 * `expiration`, `parentOrderId`, `replacementReason` — all optional,
 * mirroring `SimulationOrder`'s own extension. Every pre-Q0.12 caller
 * omitting them produces byte-identical output.
 */
export interface CreateOrderInput {
    readonly strategyVersion: string;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly quantity: number;
    readonly orderType: SimulationOrderType;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
    readonly attachedStopLoss?: number;
    readonly attachedTakeProfit?: number;
    readonly creationTimestamp: number;
    readonly expiration?: OrderExpirationPolicy;
    readonly parentOrderId?: string;
    readonly replacementReason?: string;
}
/**
 * Order identity is deterministic (Q0.5.6): the caller supplies
 * `sequence` (typically the enqueue-time sequence of the event that
 * caused this order to be created), never a random or wall-clock value.
 */
export declare function createOrder(input: CreateOrderInput, sequence: number): SimulationOrder;
/**
 * Q0.12.21 — the ONE expiration-policy evaluator, reused by both D1
 * (`simulation-engine.ts`) and D2/D3 (`multi-fidelity-engine.ts`) —
 * never a second implementation of the same four rules. `GTC` (or no
 * policy at all) never expires here; the existing end-of-run finalize
 * step remains the only thing that ever closes out a GTC order (Q0.5,
 * unmodified). `DAY` expires the instant `asOf` falls on a later trading
 * day than the order's own creation timestamp (via `computeTradingDayKey`,
 * Q0.3, reused verbatim — no second day-boundary formula). `BAR` expires
 * once `currentBarIndex - creationBarIndex >= maxBars`. `TIMESTAMP`
 * expires once `asOf >= expiresAt`. Pure — never mutates `order`, never
 * reads the wall clock.
 */
export declare function isOrderExpired(order: SimulationOrder, context: {
    readonly asOf: number;
    readonly currentBarIndex: number;
    readonly creationBarIndex: number;
    readonly dayBoundaryOffsetMinutes?: number;
}): boolean;
export interface TransitionUpdates {
    readonly filledQuantity?: number;
    readonly averageFillPrice?: number;
    readonly terminalReason?: string;
}
/**
 * Invalid transitions throw deterministically (Q0.5.5) — never silently
 * ignored, never coerced into the nearest valid state. Returns a NEW
 * order object; the input is never mutated (Q0.5.38 immutability).
 */
export declare function transitionOrder(order: SimulationOrder, next: OrderStatus, updates?: TransitionUpdates): SimulationOrder;
export declare function isTerminal(status: OrderStatus): boolean;
export { VALID_TRANSITIONS };
