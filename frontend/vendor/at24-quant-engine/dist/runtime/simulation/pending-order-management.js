import { MQL_ORDER_TYPE_CONSTANT_MAP } from "../../domain/pending-order-management-policy.js";
/**
 * Q0.13.14 — the risk/execution boundary, restated precisely: this file
 * NEVER mutates a `SimulationOrder`, never calls `transitionOrder`, and
 * never constructs a `SimulationOrder` itself. Its entire job is to
 * decide, PURELY from `order`'s own already-known fields and the CURRENT
 * bar, whether a `PendingOrderManagementPolicy` rule fires — and if so,
 * to hand back a Q0.12 `OrderModificationIntent` for the caller to run
 * through Q0.12's OWN unmodified `validateOrderModification`/
 * `applyOrderModification` (exactly as the Q0.12 declarative schedule
 * already does in `simulation-engine.ts`/`multi-fidelity-engine.ts`).
 * Q0.3's risk evaluation is never consulted and never bypassed — this
 * mechanism is entirely independent of `evaluateRisk()`, which continues
 * to be the ONLY authority over POSITION-level risk actions.
 */
/**
 * The same three arithmetic MODES `resolveStopLossPrice`/
 * `resolveTakeProfitPrice` (`rule-resolvers.ts`) already use for a
 * `DistanceSpec` — reused as plain arithmetic here (never re-derived)
 * because this function has no `Position`/entry-price context, only a
 * pending order's own reference price and the current bar.
 */
function resolveDistanceOffset(spec, referencePrice, atrValue) {
    switch (spec.mode) {
        case "absolute":
            return spec.value;
        case "percentage":
            return referencePrice * (spec.value / 100);
        case "atr-multiple":
            return atrValue !== undefined ? atrValue * spec.atrMultiple : undefined;
    }
}
function conditionHolds(rule, order, bar, atrValue) {
    const c = rule.condition;
    switch (c.kind) {
        case "ALWAYS":
            return true;
        case "ORDER_TYPE_FILTER": {
            const mapped = c.orderTypeConstant ? MQL_ORDER_TYPE_CONSTANT_MAP[c.orderTypeConstant] : undefined;
            return mapped !== undefined && mapped.orderType === order.orderType && mapped.side === order.side;
        }
        case "FAVORABLE_DISTANCE": {
            if (!c.distance)
                return false;
            const referencePrice = order.orderType === "LIMIT" ? order.limitPrice : order.stopPrice;
            if (referencePrice === undefined)
                return false;
            const offset = resolveDistanceOffset(c.distance, referencePrice, atrValue);
            if (offset === undefined)
                return false;
            // "favorable" mirrors Q0.10's resolveFavorableTriggerDistance meaning exactly, generalized
            // to a PENDING order's own reference price instead of a Position's entry price: for a BUY,
            // price falling TOWARD (below) the order's level is favorable; for a SELL, price rising
            // TOWARD (above) it is.
            const moved = order.side === "BUY" ? referencePrice - bar.close : bar.close - referencePrice;
            return moved >= offset;
        }
        case "UNKNOWN":
            return false;
    }
}
function targetMatches(rule, order) {
    const t = rule.target;
    if (t.orderTypeFilter && t.orderTypeFilter !== order.orderType)
        return false;
    if (t.sideFilter && t.sideFilter !== order.side)
        return false;
    return true;
}
/**
 * Evaluates every rule of `policy`, in declared order, against ONE
 * pending order at ONE bar; returns the FIRST rule's resulting intent, or
 * `undefined` if none fire this bar. Deterministic and lookahead-free:
 * the only inputs are `order` (already-known, created on or before this
 * bar by the caller's own same-bar safety guard) and `bar` (the bar
 * currently being processed) — never a future bar, never wall-clock
 * time, never a source of randomness. A rule that failed
 * `executableRules()`'s provability gate is skipped defensively here too
 * (belt-and-braces — the caller is expected to pass only
 * `executableRules(policy)`, but this function never trusts that
 * silently).
 */
export function evaluatePendingOrderManagementPolicy(policy, order, bar, reason, atrValue) {
    for (const rule of policy.rules) {
        if (!rule.target.provable || !rule.condition.provable || rule.operation.kind === "UNKNOWN")
            continue;
        if (!targetMatches(rule, order))
            continue;
        if (!conditionHolds(rule, order, bar, atrValue))
            continue;
        const ruleReason = `${reason} (rule "${rule.id}")`;
        switch (rule.operation.kind) {
            case "CANCEL_PENDING":
                return { orderId: order.orderId, modificationType: "CANCEL", reason: ruleReason };
            case "MODIFY_STOP": {
                if (order.orderType !== "STOP" && order.orderType !== "STOP_LIMIT")
                    continue;
                const offset = resolveDistanceOffset(rule.operation.newDistanceFromClose, bar.close, atrValue);
                if (offset === undefined)
                    continue;
                const newStopPrice = order.side === "BUY" ? bar.close + offset : bar.close - offset;
                return { orderId: order.orderId, modificationType: "MODIFY_STOP", newStopPrice, reason: ruleReason };
            }
            case "MODIFY_LIMIT": {
                if (order.orderType !== "LIMIT" && order.orderType !== "STOP_LIMIT")
                    continue;
                const offset = resolveDistanceOffset(rule.operation.newDistanceFromClose, bar.close, atrValue);
                if (offset === undefined)
                    continue;
                const newLimitPrice = order.side === "BUY" ? bar.close - offset : bar.close + offset;
                return { orderId: order.orderId, modificationType: "MODIFY_LIMIT", newLimitPrice, reason: ruleReason };
            }
            case "MODIFY_EXPIRATION":
                return { orderId: order.orderId, modificationType: "MODIFY_EXPIRATION", newExpiration: { kind: "BAR", maxBars: rule.operation.maxBars }, reason: ruleReason };
        }
    }
    return undefined;
}
