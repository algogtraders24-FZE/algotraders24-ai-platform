import type { ExistingPosition, RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
import { makeViolation } from "./violations.js";

/**
 * Whichever of maxBars/maxDurationMs is configured AND exceeded first
 * triggers (OR logic, matching Q0.2's field doc). "At the limit" (== not
 * >) is treated as exceeded, consistent with every other limit in this
 * package (>=). This function only PRODUCES an explicit result — it does
 * NOT close the position; that is execution/simulation responsibility.
 */
export function evaluateMaxHoldingPeriod(
  spec: RiskSpecification,
  position: Pick<ExistingPosition, "entryTimestamp" | "barsHeld">,
  asOf: number,
): RiskConstraintResult {
  const limit = spec.maxHoldingPeriod;
  if (limit === undefined) return { passed: true };

  if (!Number.isFinite(position.entryTimestamp) || !Number.isFinite(asOf)) {
    return {
      passed: false,
      violation: makeViolation(
        "MAX_HOLDING_PERIOD",
        "BLOCKING",
        `invalid timestamp(s) for holding-period evaluation (entryTimestamp=${position.entryTimestamp}, asOf=${asOf})`,
        null,
        null,
        "INVALID_NUMERIC_VALUE",
      ),
    };
  }

  const durationMs = asOf - position.entryTimestamp;
  const durationExceeded = limit.maxDurationMs !== undefined && durationMs >= limit.maxDurationMs;
  const barsExceeded =
    limit.maxBars !== undefined && position.barsHeld !== undefined && position.barsHeld >= limit.maxBars;

  if (durationExceeded) {
    return {
      passed: false,
      violation: makeViolation(
        "MAX_HOLDING_PERIOD",
        "BLOCKING",
        `holding duration (${durationMs}ms) >= configured maxDurationMs (${limit.maxDurationMs})`,
        durationMs,
        limit.maxDurationMs!,
        "AT_OR_BEYOND_LIMIT",
      ),
    };
  }
  if (barsExceeded) {
    return {
      passed: false,
      violation: makeViolation(
        "MAX_HOLDING_PERIOD",
        "BLOCKING",
        `bars held (${position.barsHeld}) >= configured maxBars (${limit.maxBars})`,
        position.barsHeld!,
        limit.maxBars!,
        "AT_OR_BEYOND_LIMIT",
      ),
    };
  }
  return { passed: true };
}
