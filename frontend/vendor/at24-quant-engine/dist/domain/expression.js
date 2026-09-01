import { validateSeriesOffset } from "./strategy-ir/series.js";
import { ok, fail, combine } from "./validation-result.js";
export function literal(value) {
    return { kind: "literal", value };
}
export function indicatorOperand(ref) {
    return { kind: "indicator", ref };
}
/** Q0.7.8 (additive): a raw price-series operand at an explicit bar offset — e.g. `seriesOperand("CLOSE", 1)` for `Close[1]`. */
export function seriesOperand(series, offset) {
    return { kind: "series", ref: { series, offset } };
}
export function comparison(operator, left, right) {
    return { type: "comparison", operator, left, right };
}
export function and(...operands) {
    return { type: "logical", operator: "AND", operands };
}
export function or(...operands) {
    return { type: "logical", operator: "OR", operands };
}
export function not(operand) {
    return { type: "logical", operator: "NOT", operands: [operand] };
}
export function booleanReference(ref) {
    return { type: "boolean-reference", ref };
}
/**
 * Q0.7.9 (additive): rejects a negative (future) series offset, e.g. a
 * raw transcription of `Close[-1]`. Never coerces it into something
 * executable — a source construct that genuinely needs a future offset
 * has no valid Operand representation at all and must surface as an
 * UnsupportedSemantic record upstream (domain/strategy-ir/unsupported.ts),
 * not silently clamp to 0 here.
 */
function validateOperand(operand, path) {
    if (operand.kind !== "series")
        return ok();
    return validateSeriesOffset(operand.ref) ? ok() : fail(`${path}: series offset must be a non-negative integer, got ${operand.ref.offset} (future offsets are rejected, never silently clamped)`);
}
export function validateExpression(expr, path = "expression") {
    switch (expr.type) {
        case "comparison":
            return combine(validateOperand(expr.left, `${path}.left`), validateOperand(expr.right, `${path}.right`));
        case "boolean-reference":
            return ok();
        case "logical": {
            const arityError = expr.operator === "NOT" && expr.operands.length !== 1
                ? fail(`${path}: NOT must have exactly 1 operand, got ${expr.operands.length}`)
                : expr.operator !== "NOT" && expr.operands.length < 2
                    ? fail(`${path}: ${expr.operator} must have at least 2 operands, got ${expr.operands.length}`)
                    : ok();
            const childResults = expr.operands.map((child, i) => validateExpression(child, `${path}.operands[${i}]`));
            return combine(arityError, ...childResults);
        }
    }
}
