import { resolveDistanceSpec } from "./distance-spec.js";
import { makeViolation } from "./violations.js";
/**
 * One-time behavior (Q0.3.13's "start with the simplest deterministic
 * model"): once `alreadyTriggered` is true, this never re-triggers,
 * preventing repeated unintended partial closes. `closePercent` always
 * comes straight from a spec already validated by
 * validateRiskSpecification() (which enforces (0, 100]), so this can
 * never propose closing more than the position — no separate
 * "quantity exceeds position" check is needed here, the invariant is
 * guaranteed upstream at spec-validation time. Never executes anything;
 * only returns an instruction.
 */
export function evaluatePartialClose(rule, direction, entryPrice, currentPrice, currentAtr, alreadyTriggered) {
    if (alreadyTriggered)
        return { triggered: false };
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        return {
            triggered: false,
            violation: makeViolation("PARTIAL_CLOSE_CONSTRAINT", "BLOCKING", `currentPrice ${currentPrice} is invalid`, currentPrice, 0, "INVALID_NUMERIC_VALUE"),
        };
    }
    let triggerDistance;
    try {
        triggerDistance = resolveDistanceSpec(rule.trigger, entryPrice, currentAtr);
    }
    catch (e) {
        return {
            triggered: false,
            violation: makeViolation("PARTIAL_CLOSE_CONSTRAINT", "BLOCKING", e.message, null, null, "MISSING_REQUIRED_VALUE"),
        };
    }
    const favorable = direction === "BUY" ? currentPrice - entryPrice : entryPrice - currentPrice;
    if (favorable < triggerDistance)
        return { triggered: false };
    return { triggered: true, closePercent: rule.closePercent };
}
