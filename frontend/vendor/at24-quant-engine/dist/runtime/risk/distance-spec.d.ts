import type { DistanceSpec } from "../../domain/risk-specification.js";
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
export declare function resolveDistanceSpec(spec: DistanceSpec, entryPrice: number, atrValue: number | undefined): number;
