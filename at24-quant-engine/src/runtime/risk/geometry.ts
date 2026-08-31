import type { RiskConstraintResult, RiskViolation } from "../../domain/risk-evaluation.js";
import { makeViolation } from "./violations.js";

type Direction = "BUY" | "SELL";

/**
 * BUY: SL below entry, TP above entry. SELL: SL above entry, TP below
 * entry. Equal entry/SL or entry/TP counts as invalid (a >=/<=, not a
 * strict >/<, comparison — "equal" is not "below"/"above"). Missing SL or
 * TP is not itself an error (both are optional overall); geometry is
 * only checked for whichever of the two is actually provided. `direction`
 * being anything other than "BUY"/"SELL" is prevented by the type system
 * at compile time, so no runtime "invalid direction" branch exists here.
 */
export function validateEntryGeometry(
  direction: Direction,
  entryPrice: number,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): readonly RiskViolation[] {
  const violations: RiskViolation[] = [];

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    violations.push(
      makeViolation("INVALID_RISK_DISTANCE", "BLOCKING", `entryPrice ${entryPrice} must be a finite number > 0`, entryPrice, 0, "INVALID_NUMERIC_VALUE"),
    );
    return violations; // nothing further is meaningful without a valid entry price
  }

  if (stopLoss !== undefined) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      violations.push(makeViolation("INVALID_STOP", "BLOCKING", `stopLoss ${stopLoss} must be a finite number > 0`, stopLoss, 0, "INVALID_NUMERIC_VALUE"));
    } else if (direction === "BUY" && stopLoss >= entryPrice) {
      violations.push(
        makeViolation("INVALID_STOP", "BLOCKING", `BUY stopLoss (${stopLoss}) must be below entry (${entryPrice})`, stopLoss, entryPrice, "INVALID_DIRECTION_RELATIVE_TO_ENTRY"),
      );
    } else if (direction === "SELL" && stopLoss <= entryPrice) {
      violations.push(
        makeViolation("INVALID_STOP", "BLOCKING", `SELL stopLoss (${stopLoss}) must be above entry (${entryPrice})`, stopLoss, entryPrice, "INVALID_DIRECTION_RELATIVE_TO_ENTRY"),
      );
    }
  }

  if (takeProfit !== undefined) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      violations.push(
        makeViolation("INVALID_TARGET", "BLOCKING", `takeProfit ${takeProfit} must be a finite number > 0`, takeProfit, 0, "INVALID_NUMERIC_VALUE"),
      );
    } else if (direction === "BUY" && takeProfit <= entryPrice) {
      violations.push(
        makeViolation("INVALID_TARGET", "BLOCKING", `BUY takeProfit (${takeProfit}) must be above entry (${entryPrice})`, takeProfit, entryPrice, "INVALID_DIRECTION_RELATIVE_TO_ENTRY"),
      );
    } else if (direction === "SELL" && takeProfit >= entryPrice) {
      violations.push(
        makeViolation("INVALID_TARGET", "BLOCKING", `SELL takeProfit (${takeProfit}) must be below entry (${entryPrice})`, takeProfit, entryPrice, "INVALID_DIRECTION_RELATIVE_TO_ENTRY"),
      );
    }
  }

  return violations;
}

/** BUY: entry - stop. SELL: stop - entry. Positive by construction for a valid risk. */
export function computeRiskDistance(direction: Direction, entryPrice: number, stopLoss: number): number {
  return direction === "BUY" ? entryPrice - stopLoss : stopLoss - entryPrice;
}

export function validateRiskDistance(direction: Direction, entryPrice: number, stopLoss: number): RiskConstraintResult {
  const distance = computeRiskDistance(direction, entryPrice, stopLoss);
  if (!(distance > 0)) {
    return {
      passed: false,
      violation: makeViolation("INVALID_RISK_DISTANCE", "BLOCKING", `computed risk distance (${distance}) must be > 0`, distance, 0, "BELOW_MINIMUM"),
    };
  }
  return { passed: true };
}
