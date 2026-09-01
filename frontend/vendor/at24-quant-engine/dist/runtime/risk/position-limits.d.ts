import type { RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
/**
 * If open positions >= configured maximum, the NEW position is rejected
 * (>=, not >, matching Q0.3.5's literal wording — "exactly at limit"
 * rejects, it does not squeeze in one more).
 */
export declare function evaluateMaxSimultaneousPositions(spec: RiskSpecification, openPositionCount: number): RiskConstraintResult;
