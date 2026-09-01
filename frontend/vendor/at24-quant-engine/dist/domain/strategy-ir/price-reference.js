import { ok, fail } from "../validation-result.js";
export function priceReferenceKind(ref) {
    switch (ref.kind) {
        case "OPERAND":
            if (ref.operand.kind === "literal")
                return "ABSOLUTE";
            if (ref.operand.kind === "indicator")
                return "INDICATOR_VALUE";
            return ref.operand.ref.series === "CLOSE" || ref.operand.ref.series === "OPEN" || ref.operand.ref.series === "HIGH" || ref.operand.ref.series === "LOW"
                ? ref.operand.ref.series
                : "ABSOLUTE";
        case "MID":
            return "MID";
        case "ATR_OFFSET":
            return "ATR_OFFSET";
        case "UNSUPPORTED":
            return ref.reason;
    }
}
export function validatePriceReference(ref, path) {
    switch (ref.kind) {
        case "OPERAND":
        case "MID":
            return ok();
        case "ATR_OFFSET":
            if (!(ref.atrMultiple > 0))
                return fail(`${path}: atrMultiple must be > 0`);
            if (!(ref.atrPeriod > 0))
                return fail(`${path}: atrPeriod must be > 0`);
            return ok();
        case "UNSUPPORTED":
            return fail(`${path}: "${ref.reason}" is not a deterministically computable price reference (no live bid/ask feed exists in this simulation model) — never silently approximated with an OHLCV proxy`);
    }
}
