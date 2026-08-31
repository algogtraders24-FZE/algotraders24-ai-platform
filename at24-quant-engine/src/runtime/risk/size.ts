import type { RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
import { makeViolation } from "./violations.js";

/** Handles zero, negative, NaN/non-finite, and fractional (allowed) sizes. */
export function validateProposedSize(quantity: number): RiskConstraintResult {
  if (!Number.isFinite(quantity)) {
    return {
      passed: false,
      violation: makeViolation("INVALID_SIZE", "BLOCKING", `proposed size ${quantity} is not a finite number`, quantity, null, "INVALID_NUMERIC_VALUE"),
    };
  }
  if (quantity <= 0) {
    return {
      passed: false,
      violation: makeViolation("INVALID_SIZE", "BLOCKING", `proposed size ${quantity} must be > 0`, quantity, 0, "BELOW_MINIMUM"),
    };
  }
  return { passed: true };
}

/** Broker-specific lot-step/min-lot rules are explicitly out of scope here — future ExecutionSpecification territory. */
export function validateMaxPositionSize(spec: RiskSpecification, quantity: number): RiskConstraintResult {
  if (spec.maxPositionSize === undefined) return { passed: true };
  if (quantity > spec.maxPositionSize) {
    return {
      passed: false,
      violation: makeViolation(
        "MAX_POSITION",
        "BLOCKING",
        `proposed size (${quantity}) exceeds maxPositionSize (${spec.maxPositionSize})`,
        quantity,
        spec.maxPositionSize,
        "EXCEEDS_MAXIMUM",
      ),
    };
  }
  return { passed: true };
}
