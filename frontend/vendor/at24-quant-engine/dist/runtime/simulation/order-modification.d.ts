import type { SimulationOrder } from "../../domain/simulation/order.js";
import type { OrderModificationIntent } from "../../domain/simulation/order-modification.js";
import { type CreateOrderInput } from "./order-engine.js";
/**
 * Q0.12.18 — the minimal orchestration layer. Consumes an
 * `OrderModificationIntent` (already validated by
 * `validateOrderModification` — this function assumes a valid intent and
 * never re-validates) and the order state machine (`transitionOrder`,
 * Q0.5, reused verbatim) — never a second order engine. `REPLACE`
 * returns the input for a NEW `createOrder()` call rather than
 * constructing the `SimulationOrder` itself, because only the caller
 * (the simulation loop) holds the deterministic event-queue `sequence`
 * a new order identity requires (Q0.5.6) — this function has no
 * business minting one.
 */
export type OrderModificationOutcome = {
    readonly kind: "CANCELLED";
    readonly order: SimulationOrder;
} | {
    readonly kind: "MODIFIED";
    readonly order: SimulationOrder;
} | {
    readonly kind: "REPLACED";
    readonly cancelledOrder: SimulationOrder;
    readonly newOrderInput: CreateOrderInput;
};
export declare function applyOrderModification(order: SimulationOrder, intent: OrderModificationIntent, asOf: number): OrderModificationOutcome;
