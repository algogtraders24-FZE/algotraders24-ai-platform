import type { BreakevenRule } from "../../domain/risk-specification.js";
import type { RiskViolation } from "../../domain/risk-evaluation.js";
import { resolveDistanceSpec } from "./distance-spec.js";
import { makeViolation } from "./violations.js";

type Direction = "BUY" | "SELL";

export interface PolicyEvaluation {
  readonly triggered: boolean;
  readonly newStopPrice?: number;
  readonly violation?: RiskViolation;
}

/**
 * Simplest deterministic model (Q0.3.11): once price has moved `trigger`
 * in the position's favor, propose moving the stop to `entry +/- lockOffset`.
 * Like trailing (Q0.3.12), the proposed stop is only "triggered" if it is
 * actually risk-reducing relative to the current stop (never moves
 * backward) — a position with no stop yet is always improved by adding
 * one. This function only returns an instruction; it never mutates a
 * Position.
 */
export function evaluateBreakeven(
  rule: BreakevenRule,
  direction: Direction,
  entryPrice: number,
  currentPrice: number,
  currentAtr: number | undefined,
  currentStopLoss: number | undefined,
): PolicyEvaluation {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      triggered: false,
      violation: makeViolation("BREAKEVEN_CONSTRAINT", "BLOCKING", `currentPrice ${currentPrice} is invalid`, currentPrice, 0, "INVALID_NUMERIC_VALUE"),
    };
  }

  let triggerDistance: number;
  let lockDistance: number;
  try {
    triggerDistance = resolveDistanceSpec(rule.trigger, entryPrice, currentAtr);
    lockDistance = resolveDistanceSpec(rule.lockOffset, entryPrice, currentAtr);
  } catch (e) {
    return {
      triggered: false,
      violation: makeViolation("BREAKEVEN_CONSTRAINT", "BLOCKING", (e as Error).message, null, null, "MISSING_REQUIRED_VALUE"),
    };
  }

  const favorable = direction === "BUY" ? currentPrice - entryPrice : entryPrice - currentPrice;
  if (favorable < triggerDistance) {
    return { triggered: false };
  }

  const proposedStop = direction === "BUY" ? entryPrice + lockDistance : entryPrice - lockDistance;

  if (currentStopLoss !== undefined) {
    const improves = direction === "BUY" ? proposedStop > currentStopLoss : proposedStop < currentStopLoss;
    if (!improves) return { triggered: false };
  }

  return { triggered: true, newStopPrice: proposedStop };
}
