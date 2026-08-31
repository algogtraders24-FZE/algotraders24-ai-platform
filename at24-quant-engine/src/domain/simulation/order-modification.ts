import type { OrderSide } from "../order-intent.js";
import type { OrderExpirationPolicy, OrderStatus } from "./order.js";
import { type ValidationResult, ok, fail } from "../validation-result.js";

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

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(["FILLED", "CANCELLED", "EXPIRED", "REJECTED"]);

/**
 * Q0.12.20 — the reference-price direction every price modification must
 * respect, explicit rather than assumed: a BUY LIMIT sits BELOW the
 * reference (you're offering to buy cheaper than now); a SELL LIMIT
 * sits ABOVE (selling for more); a BUY STOP sits ABOVE (buying into a
 * breakout); a SELL STOP sits BELOW (selling into a breakdown) — exactly
 * mirroring `bar-fill-model.ts`'s own BUY/SELL asymmetry for LIMIT/STOP
 * fills (Q0.11), never a new, second directional convention.
 */
function validateDirectionalPrice(side: OrderSide, kind: "LIMIT" | "STOP", price: number, referencePrice: number, path: string): ValidationResult {
  if (kind === "LIMIT") {
    if (side === "BUY" && !(price < referencePrice)) return fail(`${path}: a BUY LIMIT price (${price}) must remain below the reference price (${referencePrice})`);
    if (side === "SELL" && !(price > referencePrice)) return fail(`${path}: a SELL LIMIT price (${price}) must remain above the reference price (${referencePrice})`);
  } else {
    if (side === "BUY" && !(price > referencePrice)) return fail(`${path}: a BUY STOP price (${price}) must remain above the reference price (${referencePrice})`);
    if (side === "SELL" && !(price < referencePrice)) return fail(`${path}: a SELL STOP price (${price}) must remain below the reference price (${referencePrice})`);
  }
  return ok();
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
export function validateOrderModification(order: OrderForModification | undefined, intent: OrderModificationIntent, referencePrice: number): ValidationResult {
  if (!order) return fail(`order "${intent.orderId}" not found`);
  if (TERMINAL_STATUSES.has(order.status)) return fail(`order "${intent.orderId}" is already ${order.status} — cannot ${intent.modificationType} a terminal order`);

  switch (intent.modificationType) {
    case "CANCEL":
      return ok();
    case "MODIFY_PRICE": {
      if (intent.newPrice === undefined) return fail("MODIFY_PRICE requires newPrice");
      if (intent.newStopPrice !== undefined || intent.newLimitPrice !== undefined) return fail("MODIFY_PRICE must not also populate newStopPrice/newLimitPrice");
      if (!Number.isFinite(intent.newPrice) || intent.newPrice <= 0) return fail(`newPrice must be a positive finite number, got ${intent.newPrice}`);
      if (order.orderType === "STOP_LIMIT") return fail(`MODIFY_PRICE is ambiguous for a STOP_LIMIT order (it has two prices) — use MODIFY_STOP/MODIFY_LIMIT instead`);
      if (order.orderType === "MARKET") return fail(`MODIFY_PRICE is not applicable to a MARKET order (it has no pending price to modify)`);
      const kind = order.orderType === "LIMIT" ? "LIMIT" : "STOP";
      return validateDirectionalPrice(order.side, kind, intent.newPrice, referencePrice, "newPrice");
    }
    case "MODIFY_STOP": {
      if (intent.newStopPrice === undefined) return fail("MODIFY_STOP requires newStopPrice");
      if (order.orderType !== "STOP" && order.orderType !== "STOP_LIMIT") return fail(`MODIFY_STOP is not applicable to a ${order.orderType} order`);
      if (!Number.isFinite(intent.newStopPrice) || intent.newStopPrice <= 0) return fail(`newStopPrice must be a positive finite number, got ${intent.newStopPrice}`);
      return validateDirectionalPrice(order.side, "STOP", intent.newStopPrice, referencePrice, "newStopPrice");
    }
    case "MODIFY_LIMIT": {
      if (intent.newLimitPrice === undefined) return fail("MODIFY_LIMIT requires newLimitPrice");
      if (order.orderType !== "LIMIT" && order.orderType !== "STOP_LIMIT") return fail(`MODIFY_LIMIT is not applicable to a ${order.orderType} order`);
      if (!Number.isFinite(intent.newLimitPrice) || intent.newLimitPrice <= 0) return fail(`newLimitPrice must be a positive finite number, got ${intent.newLimitPrice}`);
      return validateDirectionalPrice(order.side, "LIMIT", intent.newLimitPrice, referencePrice, "newLimitPrice");
    }
    case "MODIFY_EXPIRATION":
      return intent.newExpiration === undefined ? fail("MODIFY_EXPIRATION requires newExpiration") : ok();
    case "REPLACE":
      return intent.newLimitPrice === undefined && intent.newStopPrice === undefined && intent.newExpiration === undefined
        ? fail("REPLACE requires at least one of newLimitPrice/newStopPrice/newExpiration to actually change something — otherwise it is a no-op cancel+recreate, never silently permitted")
        : ok();
    default: {
      const exhaustive: never = intent.modificationType;
      return fail(`unsupported modificationType: ${String(exhaustive)}`);
    }
  }
}
