import type { ExistingPosition, RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
/**
 * Whichever of maxBars/maxDurationMs is configured AND exceeded first
 * triggers (OR logic, matching Q0.2's field doc). "At the limit" (== not
 * >) is treated as exceeded, consistent with every other limit in this
 * package (>=). This function only PRODUCES an explicit result — it does
 * NOT close the position; that is execution/simulation responsibility.
 */
export declare function evaluateMaxHoldingPeriod(spec: RiskSpecification, position: Pick<ExistingPosition, "entryTimestamp" | "barsHeld">, asOf: number): RiskConstraintResult;
