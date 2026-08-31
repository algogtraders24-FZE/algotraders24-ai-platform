import type { SimulationOrder } from "../../domain/simulation/order.js";
import type { OrderModificationIntent } from "../../domain/simulation/order-modification.js";
import { transitionOrder, type CreateOrderInput } from "./order-engine.js";

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
export type OrderModificationOutcome =
  | { readonly kind: "CANCELLED"; readonly order: SimulationOrder }
  | { readonly kind: "MODIFIED"; readonly order: SimulationOrder }
  | { readonly kind: "REPLACED"; readonly cancelledOrder: SimulationOrder; readonly newOrderInput: CreateOrderInput };

export function applyOrderModification(order: SimulationOrder, intent: OrderModificationIntent, asOf: number): OrderModificationOutcome {
  switch (intent.modificationType) {
    case "CANCEL":
      return { kind: "CANCELLED", order: transitionOrder(order, "CANCELLED", { terminalReason: intent.reason }) };

    case "MODIFY_PRICE": {
      const isLimit = order.orderType === "LIMIT";
      return { kind: "MODIFIED", order: { ...order, ...(isLimit ? { limitPrice: intent.newPrice! } : { stopPrice: intent.newPrice! }) } };
    }

    case "MODIFY_STOP":
      return { kind: "MODIFIED", order: { ...order, stopPrice: intent.newStopPrice! } };

    case "MODIFY_LIMIT":
      return { kind: "MODIFIED", order: { ...order, limitPrice: intent.newLimitPrice! } };

    case "MODIFY_EXPIRATION":
      return { kind: "MODIFIED", order: { ...order, expiration: intent.newExpiration! } };

    case "REPLACE": {
      const cancelledOrder = transitionOrder(order, "CANCELLED", { terminalReason: `replaced: ${intent.reason}` });
      const newLimitPrice = intent.newLimitPrice ?? order.limitPrice;
      const newStopPrice = intent.newStopPrice ?? order.stopPrice;
      const newExpiration = intent.newExpiration ?? order.expiration;
      const newOrderInput: CreateOrderInput = {
        strategyVersion: order.strategyVersion,
        instrument: order.instrument,
        side: order.side,
        quantity: order.quantity,
        orderType: order.orderType,
        ...(newLimitPrice !== undefined ? { limitPrice: newLimitPrice } : {}),
        ...(newStopPrice !== undefined ? { stopPrice: newStopPrice } : {}),
        ...(order.attachedStopLoss !== undefined ? { attachedStopLoss: order.attachedStopLoss } : {}),
        ...(order.attachedTakeProfit !== undefined ? { attachedTakeProfit: order.attachedTakeProfit } : {}),
        creationTimestamp: asOf,
        ...(newExpiration !== undefined ? { expiration: newExpiration } : {}),
        parentOrderId: order.orderId,
        replacementReason: intent.reason,
      };
      return { kind: "REPLACED", cancelledOrder, newOrderInput };
    }
  }
}
