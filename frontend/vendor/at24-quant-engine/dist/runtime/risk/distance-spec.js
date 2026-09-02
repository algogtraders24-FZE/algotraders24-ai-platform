/**
 * Resolves a DistanceSpec to a concrete price distance. Throws (rather
 * than returning a RiskViolation) only when required CONTEXT is missing
 * (an atr-multiple spec with no ATR value supplied) — this is a caller
 * integration error, not a domain-level risk violation, mirroring how
 * runtime/expression-evaluator.ts throws for a missing indicator value.
 * Every caller inside this package's risk pipeline catches this and
 * converts it to a proper RiskViolation before it can escape
 * evaluateRisk() (see pipeline.ts) — evaluateRisk() itself never throws.
 */
export function resolveDistanceSpec(spec, entryPrice, atrValue) {
    switch (spec.mode) {
        case "absolute":
            return spec.value;
        case "percentage":
            return (spec.value / 100) * entryPrice;
        case "atr-multiple":
            if (atrValue === undefined) {
                throw new Error("atr-multiple DistanceSpec requires an ATR value, none was provided");
            }
            return spec.atrMultiple * atrValue;
    }
}
