import type { TrailingStopRule } from "../../domain/risk-specification.js";
import { resolveDistanceSpec } from "./distance-spec.js";
import { makeViolation } from "./violations.js";
import type { PolicyEvaluation } from "./breakeven.js";

type Direction = "BUY" | "SELL";

/**
 * Trigger / Distance / Adjustment kept explicit and separate: once price
 * has moved `activation` in favor, the stop trails `distance` behind the
 * current price. The stop may only move in a risk-reducing direction and
 * must never move backward — if the naive computed trail is not strictly
 * better than the current stop, this returns `triggered: false` (not a
 * violation; simply nothing to do this call). No execution occurs here.
 */
export function evaluateTrailingStop(
  rule: TrailingStopRule,
  direction: Direction,
  entryPrice: number,
  currentPrice: number,
  currentStopLoss: number | undefined,
  currentAtr: number | undefined,
): PolicyEvaluation {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      triggered: false,
      violation: makeViolation("TRAILING_CONSTRAINT", "BLOCKING", `currentPrice ${currentPrice} is invalid`, currentPrice, 0, "INVALID_NUMERIC_VALUE"),
    };
  }

  let activationDistance: number;
  let trailDistance: number;
  try {
    activationDistance = resolveDistanceSpec(rule.activation, entryPrice, currentAtr);
    trailDistance = resolveDistanceSpec(rule.distance, entryPrice, currentAtr);
  } catch (e) {
    return {
      triggered: false,
      violation: makeViolation("TRAILING_CONSTRAINT", "BLOCKING", (e as Error).message, null, null, "MISSING_REQUIRED_VALUE"),
    };
  }

  const favorable = direction === "BUY" ? currentPrice - entryPrice : entryPrice - currentPrice;
  if (favorable < activationDistance) {
    return { triggered: false };
  }

  const proposedStop = direction === "BUY" ? currentPrice - trailDistance : currentPrice + trailDistance;

  if (currentStopLoss !== undefined) {
    const improves = direction === "BUY" ? proposedStop > currentStopLoss : proposedStop < currentStopLoss;
    if (!improves) return { triggered: false };
  }

  return { triggered: true, newStopPrice: proposedStop };
}
