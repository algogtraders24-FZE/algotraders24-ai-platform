import { ok, fail, combine } from "./validation-result.js";
/**
 * Q0.13 — the ONE pending-order-type-constant mapping (MQL4 `OP_*` and,
 * since Q1.5.2, MQL5 `ORDER_TYPE_*`), shared by the IR compiler
 * (`ir-generator.ts`, which needs it to decide MODIFY_STOP vs MODIFY_LIMIT
 * when a rule's condition provably names the order's own type) and the
 * runtime evaluator (`runtime/simulation/pending-order-management.ts`,
 * which needs the identical mapping to check a rule's target/condition
 * against a real `SimulationOrder`'s own type at evaluation time) — a
 * single source of truth, never two drifting copies.
 *
 * Q1.5.2 (additive): added the four MQL5 `ORDER_TYPE_*` pending-order
 * constants, mapped consistently with their MQL4 `OP_*` equivalents. This
 * is the piece that makes `OrderGetInteger(ORDER_TYPE)` recognition
 * (`semantic-analyzer.ts`'s `resolveOrderTypeFilter`) actually executable
 * at runtime — recognizing the call alone is not sufficient; without an
 * entry here the resolved constant would fail this lookup and the rule
 * would silently never fire (see docs/Q1.5_ORDER_TYPE_SEMANTICS.md).
 * `ORDER_TYPE_BUY_STOP_LIMIT`/`ORDER_TYPE_SELL_STOP_LIMIT` (compound
 * stop-limit types) are deliberately NOT mapped — this value type has no
 * "STOP_LIMIT" case (mirrors MQL4's own `OP_BUY`/`OP_SELL` market orders
 * being absent here too) and adding one is out of Q1.5's scope.
 */
export const MQL_ORDER_TYPE_CONSTANT_MAP = {
    OP_BUYLIMIT: { orderType: "LIMIT", side: "BUY" },
    OP_SELLLIMIT: { orderType: "LIMIT", side: "SELL" },
    OP_BUYSTOP: { orderType: "STOP", side: "BUY" },
    OP_SELLSTOP: { orderType: "STOP", side: "SELL" },
    ORDER_TYPE_BUY_LIMIT: { orderType: "LIMIT", side: "BUY" },
    ORDER_TYPE_SELL_LIMIT: { orderType: "LIMIT", side: "SELL" },
    ORDER_TYPE_BUY_STOP: { orderType: "STOP", side: "BUY" },
    ORDER_TYPE_SELL_STOP: { orderType: "STOP", side: "SELL" },
};
export function hasPendingOrderManagement(policy) {
    return (policy?.rules.length ?? 0) > 0;
}
/**
 * Q0.13.15 — the ONE gate a rule must pass before it may ever reach the
 * runtime evaluator: target, condition, AND operation must each be fully
 * provable. A rule failing any of these is EXCLUDED here, never executed
 * with a guessed/defaulted value (Q0.13's "never convert uncertain
 * source behavior into an executable approximation").
 */
export function executableRules(policy) {
    return policy.rules.filter((r) => r.target.provable && r.condition.provable && r.operation.kind !== "UNKNOWN");
}
function validateOrderTargetSpec(target, path) {
    if (target.provable && target.kind === "UNKNOWN")
        return fail(`${path}: target.provable is true but target.kind is "UNKNOWN" — an unresolved target must never be marked provable`);
    return ok();
}
function validateManagementCondition(condition, path) {
    const results = [];
    if (condition.provable && condition.kind === "UNKNOWN")
        results.push(fail(`${path}: condition.provable is true but condition.kind is "UNKNOWN"`));
    if (condition.kind === "ORDER_TYPE_FILTER" && !condition.orderTypeConstant)
        results.push(fail(`${path}: ORDER_TYPE_FILTER condition requires orderTypeConstant`));
    if (condition.kind === "FAVORABLE_DISTANCE" && !condition.distance)
        results.push(fail(`${path}: FAVORABLE_DISTANCE condition requires distance`));
    return combine(...results);
}
/** Q0.13 — structural validation only, mirroring every prior sprint's domain/*.ts pattern (Q0.2/Q0.7/Q0.10). */
export function validatePendingOrderManagementPolicy(policy) {
    const results = [];
    const ids = new Set();
    policy.rules.forEach((rule, i) => {
        const path = `pendingOrderManagement.rules[${i}](${rule.id})`;
        if (!rule.id.trim())
            results.push(fail(`${path}: id must not be empty`));
        if (ids.has(rule.id))
            results.push(fail(`duplicate pendingOrderManagement rule id: "${rule.id}"`));
        ids.add(rule.id);
        results.push(validateOrderTargetSpec(rule.target, path));
        results.push(validateManagementCondition(rule.condition, path));
        if (rule.operation.kind === "MODIFY_EXPIRATION" && rule.operation.maxBars <= 0) {
            results.push(fail(`${path}: MODIFY_EXPIRATION.maxBars must be > 0`));
        }
    });
    return combine(...results);
}
