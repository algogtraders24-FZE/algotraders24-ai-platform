import type { OrderModificationIntent } from "../../src/domain/simulation/order-modification.js";
import { ORD_INSTRUMENT } from "./q11-order-fixtures.js";

/**
 * Q0.12 — order IDs are fully deterministic
 * (`${strategyVersion}:${symbol}:${side}:${orderType}:${creationTimestamp}:${sequence}`,
 * Q0.5.6) but `sequence` depends on the exact count of events enqueued
 * before order creation. Every Q0.12 fixture uses the IDENTICAL simple
 * setup `q11-order-fixtures.ts` established (a single PRICE-indicator
 * entry rule firing on bar 0, no other complexity) specifically so this
 * ONE verified sequence number (empirically confirmed via
 * `test/q11-golden-fixtures.test.ts`'s own passing assertions, and
 * re-confirmed directly by `test/q12-golden-fixtures.test.ts`'s own
 * first fixture) is reusable everywhere, rather than every test
 * separately guessing at event-queue internals.
 */
export const ENTRY_ORDER_SEQUENCE = 2;

export function predictedOrderId(strategyVersion: string, side: "BUY" | "SELL", orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT", creationTimestamp: number, sequence: number = ENTRY_ORDER_SEQUENCE): string {
  return `${strategyVersion}:${ORD_INSTRUMENT.symbol}:${side}:${orderType}:${creationTimestamp}:${sequence}`;
}

export function cancelIntent(orderId: string, reason: string): OrderModificationIntent {
  return { orderId, modificationType: "CANCEL", reason };
}

export function modifyStopIntent(orderId: string, newStopPrice: number, reason: string): OrderModificationIntent {
  return { orderId, modificationType: "MODIFY_STOP", newStopPrice, reason };
}

export function modifyLimitIntent(orderId: string, newLimitPrice: number, reason: string): OrderModificationIntent {
  return { orderId, modificationType: "MODIFY_LIMIT", newLimitPrice, reason };
}

export function modifyExpirationIntent(orderId: string, newExpiration: NonNullable<OrderModificationIntent["newExpiration"]>, reason: string): OrderModificationIntent {
  return { orderId, modificationType: "MODIFY_EXPIRATION", newExpiration, reason };
}

export function replaceIntent(orderId: string, reason: string, prices: { newLimitPrice?: number; newStopPrice?: number } = {}): OrderModificationIntent {
  return { orderId, modificationType: "REPLACE", reason, ...prices };
}
