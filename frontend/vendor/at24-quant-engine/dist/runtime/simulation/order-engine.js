import { computeTradingDayKey } from "../risk/daily-loss.js";
/**
 * The Q0.4-frozen lifecycle (docs/Q0.4_EVENT_MODEL.md), reused verbatim.
 * Terminal states (FILLED/CANCELLED/EXPIRED/REJECTED) have no outgoing
 * transitions at all.
 */
const VALID_TRANSITIONS = {
    NEW: ["SUBMITTED"],
    SUBMITTED: ["ACCEPTED", "REJECTED"],
    ACCEPTED: ["TRIGGERED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"],
    TRIGGERED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"],
    PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"],
    FILLED: [],
    CANCELLED: [],
    EXPIRED: [],
    REJECTED: [],
};
/**
 * Order identity is deterministic (Q0.5.6): the caller supplies
 * `sequence` (typically the enqueue-time sequence of the event that
 * caused this order to be created), never a random or wall-clock value.
 */
export function createOrder(input, sequence) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
        throw new Error(`createOrder: quantity must be a finite number > 0, got ${input.quantity}`);
    }
    if ((input.orderType === "LIMIT" || input.orderType === "STOP_LIMIT") && input.limitPrice === undefined) {
        throw new Error(`createOrder: orderType "${input.orderType}" requires limitPrice`);
    }
    if ((input.orderType === "STOP" || input.orderType === "STOP_LIMIT") && input.stopPrice === undefined) {
        throw new Error(`createOrder: orderType "${input.orderType}" requires stopPrice`);
    }
    const orderId = `${input.strategyVersion}:${input.instrument.symbol}:${input.side}:${input.orderType}:${input.creationTimestamp}:${sequence}`;
    return {
        orderId,
        strategyVersion: input.strategyVersion,
        instrument: input.instrument,
        side: input.side,
        quantity: input.quantity,
        orderType: input.orderType,
        ...(input.limitPrice !== undefined ? { limitPrice: input.limitPrice } : {}),
        ...(input.stopPrice !== undefined ? { stopPrice: input.stopPrice } : {}),
        ...(input.attachedStopLoss !== undefined ? { attachedStopLoss: input.attachedStopLoss } : {}),
        ...(input.attachedTakeProfit !== undefined ? { attachedTakeProfit: input.attachedTakeProfit } : {}),
        creationTimestamp: input.creationTimestamp,
        sequence,
        status: "NEW",
        filledQuantity: 0,
        ...(input.expiration !== undefined ? { expiration: input.expiration } : {}),
        ...(input.parentOrderId !== undefined ? { parentOrderId: input.parentOrderId } : {}),
        ...(input.replacementReason !== undefined ? { replacementReason: input.replacementReason } : {}),
    };
}
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
export function isOrderExpired(order, context) {
    const policy = order.expiration;
    if (policy === undefined || policy.kind === "GTC")
        return false;
    switch (policy.kind) {
        case "DAY":
            return computeTradingDayKey(context.asOf, context.dayBoundaryOffsetMinutes ?? 0) !== computeTradingDayKey(order.creationTimestamp, context.dayBoundaryOffsetMinutes ?? 0);
        case "BAR":
            return context.currentBarIndex - context.creationBarIndex >= policy.maxBars;
        case "TIMESTAMP":
            return context.asOf >= policy.expiresAt;
    }
}
/**
 * Invalid transitions throw deterministically (Q0.5.5) — never silently
 * ignored, never coerced into the nearest valid state. Returns a NEW
 * order object; the input is never mutated (Q0.5.38 immutability).
 */
export function transitionOrder(order, next, updates = {}) {
    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed.includes(next)) {
        throw new Error(`Invalid order transition: ${order.status} -> ${next} (orderId=${order.orderId})`);
    }
    return { ...order, status: next, ...updates };
}
export function isTerminal(status) {
    return VALID_TRANSITIONS[status].length === 0;
}
export { VALID_TRANSITIONS };
