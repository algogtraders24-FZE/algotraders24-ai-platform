import type { RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification, SessionHoursRule } from "../../domain/risk-specification.js";
export declare function isWithinAnySessionWindow(timestampMs: number, session: SessionHoursRule): boolean;
/**
 * Entry-time-only gate (Q0.2's field doc: "does not affect exits").
 * `SessionHoursRule.windows` cannot itself express a window crossing
 * midnight (Q0.2 constraint: start < end) — an "overnight session" must
 * be expressed as two separate windows by the caller; this is a known,
 * documented limitation carried forward from Q0.2, not something this
 * function works around.
 */
export declare function evaluateSessionEligibility(spec: RiskSpecification, asOf: number): RiskConstraintResult;
