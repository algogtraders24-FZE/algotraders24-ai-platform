import type { OrderSide } from "../order-intent.js";

/** Q0.7.13 — matches Q0.5's SimulationOrderType exactly (reused vocabulary, not redefined) so a future reducer's mapping to the execution engine is 1:1. */
export type OrderTypeIR = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export type TimeInForce = "GTC" | "DAY" | "IOC" | "FOK" | "GTD";

/**
 * Q0.7.13 — pending-order intent as a strategy AUTHOR expresses it in
 * source (MQL's OrderSend/OrderModify, Pine's strategy.order), distinct
 * from Q0.5's runtime `SimulationOrder` (which is the ENGINE's own
 * lifecycle record, produced by the risk/execution layers, never
 * authored directly by a strategy). `parentOrderId` represents an
 * OCO/bracket relationship (e.g. this order is the take-profit leg of
 * another order) — IR-only bookkeeping, not an execution guarantee.
 */
export interface OrderIR {
  readonly orderType: OrderTypeIR;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price?: number;
  readonly trigger?: number;
  readonly timeInForce: TimeInForce;
  readonly reduceOnly: boolean;
  readonly parentOrderId?: string;
}
