import type { RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
/** Handles zero, negative, NaN/non-finite, and fractional (allowed) sizes. */
export declare function validateProposedSize(quantity: number): RiskConstraintResult;
/** Broker-specific lot-step/min-lot rules are explicitly out of scope here — future ExecutionSpecification territory. */
export declare function validateMaxPositionSize(spec: RiskSpecification, quantity: number): RiskConstraintResult;
