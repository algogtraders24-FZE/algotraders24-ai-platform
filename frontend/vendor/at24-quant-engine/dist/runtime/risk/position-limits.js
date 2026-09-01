import { makeViolation } from "./violations.js";
/**
 * If open positions >= configured maximum, the NEW position is rejected
 * (>=, not >, matching Q0.3.5's literal wording — "exactly at limit"
 * rejects, it does not squeeze in one more).
 */
export function evaluateMaxSimultaneousPositions(spec, openPositionCount) {
    const limit = spec.maxSimultaneousPositions;
    if (limit === undefined)
        return { passed: true };
    if (openPositionCount >= limit) {
        return {
            passed: false,
            violation: makeViolation("MAX_SIMULTANEOUS_POSITIONS", "BLOCKING", `open positions (${openPositionCount}) >= configured maximum (${limit})`, openPositionCount, limit, "AT_OR_BEYOND_LIMIT"),
        };
    }
    return { passed: true };
}
