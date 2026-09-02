import { resolveOperand } from "../expression-evaluator.js";
import { indicator, indicatorKey } from "../../domain/indicator-reference.js";
/**
 * Q0.11.3 — the ONE resolver from a `PriceReference` to a concrete
 * number, reused by both the simulation adapter (order creation) and any
 * future validation/preview tooling — never a second implementation.
 * `OPERAND` reuses `resolveOperand` (Q0's own expression-evaluator,
 * exported additively for exactly this purpose) rather than
 * re-implementing series/indicator/literal resolution. Throws (never
 * silently approximates) for `UNSUPPORTED` and for any operand that
 * resolves to a boolean where a price number was required.
 */
export function resolvePriceReference(ref, state) {
    switch (ref.kind) {
        case "OPERAND": {
            const value = resolveOperand(ref.operand, state);
            if (typeof value !== "number") {
                throw new Error("resolvePriceReference: OPERAND resolved to a boolean, not a price number");
            }
            return value;
        }
        case "MID": {
            const bar = state.bars[state.bars.length - 1];
            if (!bar)
                throw new Error("resolvePriceReference: MID requires at least one bar of history");
            return (bar.high + bar.low) / 2;
        }
        case "ATR_OFFSET": {
            const baseValue = resolveOperand(ref.base, state);
            if (typeof baseValue !== "number") {
                throw new Error("resolvePriceReference: ATR_OFFSET's base operand resolved to a boolean, not a price number");
            }
            const atrKey = indicatorKey(indicator("ATR", ref.atrPeriod));
            const atrValue = state.indicatorValues.get(atrKey);
            if (typeof atrValue !== "number") {
                throw new Error(`resolvePriceReference: ATR_OFFSET requires indicator "${atrKey}" in MarketState.indicatorValues, none found`);
            }
            const offset = ref.atrMultiple * atrValue;
            return ref.direction === "ADD" ? baseValue + offset : baseValue - offset;
        }
        case "UNSUPPORTED":
            throw new Error(`resolvePriceReference: "${ref.reason}" is not a deterministically computable price reference in this simulation model (no live bid/ask feed) — this must be caught at the eligibility gate, never reached at runtime`);
    }
}
