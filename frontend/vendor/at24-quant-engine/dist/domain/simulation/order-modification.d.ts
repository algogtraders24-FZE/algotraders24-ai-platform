import type { OrderSide } from "../order-intent.js";
import type { OrderExpirationPolicy, OrderStatus } from "./order.js";
import { type ValidationResult } from "../validation-result.js";
/**
 * Q0.12.15 — the six order-modification operations. Deliberately
 * distinct from Q0.10's `PositionManagementInstruction` (`domain/position-management.ts`)
 * — a `MODIFY_STOP` there moves an OPEN POSITION's protective stop;
 * these operations act ONLY on a still-PENDING `SimulationOrder`. The
 * two never share a type or a code path (Q0.12.30).
 */
export type OrderModificationType = "MODIFY_PRICE" | "MODIFY_STOP" | "MODIFY_LIMIT" | "MODIFY_EXPIRATION" | "CANCEL" | "REPLACE";
/**
 * Q0.12.14 — canonical modification intent. "Only fields applicable to
 * the operation may be populated" (Q0.12.14's own rule) is enforced by
 * `validateOrderModification` below, never merely by convention.
 */
export interface OrderModificationIntent {
    readonly orderId: string;
    readonly modificationType: OrderModificationType;
    /** For MODIFY_PRICE only — the single unambiguous price field for an order type that has just one (e.g. a plain LIMIT or STOP order, never STOP_LIMIT). */
    readonly newPrice?: number;
    readonly newStopPrice?: number;
    readonly newLimitPrice?: number;
    readonly newExpiration?: OrderExpirationPolicy;
    readonly reason: string;
}
export interface OrderForModification {
    readonly orderId: string;
    readonly status: OrderStatus;
    readonly orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
    readonly side: OrderSide;
}
/**
 * Q0.12.19 — every listed failure mode rejected explicitly, never
 * silently coerced or ignored. `order` is `undefined` for a "missing
 * order" check (Q0.12.39's own failure-catalog item); a terminal-status
 * order (`FILLED`/`CANCELLED`/`EXPIRED`/`REJECTED`) is rejected for
 * EVERY operation, including a second CANCEL (Q0.12.16's explicit
 * "FILLED -> CANCELLED must be illegal" and "cancel after cancel").
 */
export declare function validateOrderModification(order: OrderForModification | undefined, intent: OrderModificationIntent, referencePrice: number): ValidationResult;
