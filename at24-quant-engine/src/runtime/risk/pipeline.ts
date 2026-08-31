import type { RiskEvaluationInput, RiskEvaluationResult, RiskViolation } from "../../domain/risk-evaluation.js";
import { validateProposedSize, validateMaxPositionSize } from "./size.js";
import { validateEntryGeometry, validateRiskDistance } from "./geometry.js";
import { evaluateSessionEligibility } from "./session.js";
import { evaluateMaxSimultaneousPositions } from "./position-limits.js";
import { evaluateDailyLossLimit } from "./daily-loss.js";
import { evaluateMaxHoldingPeriod } from "./holding-period.js";
import { evaluateBreakeven } from "./breakeven.js";
import { evaluateTrailingStop } from "./trailing.js";
import { evaluatePartialClose } from "./partial-close.js";

/**
 * Deterministic pipeline (Q0.3.16) implementing explicit conflict
 * resolution (Q0.3.15) — safety constraints dominate optimization/
 * management constraints, and within each category the order below is
 * the ENTIRE priority rule; nothing is implicit:
 *
 *   ENTRY evaluation (input.proposedEntry set):
 *     1. Input validation (size, geometry, risk distance, max position
 *        size) — ALL such violations are collected together and reported
 *        as one REJECTED result, since they all mean "this trade proposal
 *        is malformed," independent of anything else.
 *     2. Session eligibility
 *     3. Max simultaneous positions
 *     4. Daily loss limit
 *     -> ALLOWED/ALLOW_ENTRY only if every stage above passes.
 *
 *   MANAGEMENT evaluation (input.existingPosition set):
 *     1. Max holding period -> FORCE_EXIT_REQUIRED (highest priority:
 *        overrides any stop/partial-close management action)
 *     2. Breakeven -> MOVE_STOP
 *     3. Trailing stop -> MOVE_STOP (only reached if breakeven did not
 *        trigger this call)
 *     4. Partial close -> PARTIAL_CLOSE (only reached if neither stop
 *        policy triggered)
 *     -> ALLOWED/NO_ACTION if nothing above triggers.
 *
 * REJECTED has three distinct meanings depending on `action.type`:
 *   REJECT_ENTRY          — a proposed entry was blocked.
 *   FORCE_EXIT_REQUIRED   — an open position may no longer remain open.
 *   NO_ACTION (with a *_CONSTRAINT violation) — a management policy could
 *     not be evaluated because required context (e.g. an ATR value) was
 *     missing; the caller must supply it before this position can be
 *     safely managed. This is the only case where REJECTED does not mean
 *     "something in the market/portfolio state failed a rule" — it means
 *     the evaluation itself was under-specified.
 *
 * evaluateRisk() never throws and never mutates any input (Q0.3.17) — it
 * reads `input` and constructs a fresh result object only.
 */
export function evaluateRisk(input: RiskEvaluationInput): RiskEvaluationResult {
  if (input.proposedEntry) {
    return evaluateEntry(input, input.proposedEntry);
  }
  if (input.existingPosition) {
    return evaluateManagement(input, input.existingPosition);
  }
  return { outcome: "ALLOWED", action: { type: "NO_ACTION" }, violations: [], evaluatedAt: input.asOf };
}

function evaluateEntry(input: RiskEvaluationInput, entry: NonNullable<RiskEvaluationInput["proposedEntry"]>): RiskEvaluationResult {
  const violations: RiskViolation[] = [];

  const sizeResult = validateProposedSize(entry.quantity);
  if (!sizeResult.passed) violations.push(sizeResult.violation!);

  const geometryViolations = validateEntryGeometry(input.direction, entry.entryPrice, entry.stopLoss, entry.takeProfit);
  violations.push(...geometryViolations);

  if (entry.stopLoss !== undefined && geometryViolations.length === 0) {
    const distanceResult = validateRiskDistance(input.direction, entry.entryPrice, entry.stopLoss);
    if (!distanceResult.passed) violations.push(distanceResult.violation!);
  }

  const maxPosResult = validateMaxPositionSize(input.riskSpecification, entry.quantity);
  if (!maxPosResult.passed) violations.push(maxPosResult.violation!);

  if (violations.length > 0) {
    return { outcome: "REJECTED", action: { type: "REJECT_ENTRY" }, violations, evaluatedAt: input.asOf };
  }

  const sessionResult = evaluateSessionEligibility(input.riskSpecification, input.asOf);
  if (!sessionResult.passed) {
    return { outcome: "REJECTED", action: { type: "REJECT_ENTRY" }, violations: [sessionResult.violation!], evaluatedAt: input.asOf };
  }

  const posLimitResult = evaluateMaxSimultaneousPositions(input.riskSpecification, input.portfolio.openPositionCount);
  if (!posLimitResult.passed) {
    return { outcome: "REJECTED", action: { type: "REJECT_ENTRY" }, violations: [posLimitResult.violation!], evaluatedAt: input.asOf };
  }

  const dailyLossResult = evaluateDailyLossLimit(input.riskSpecification, input.dailyLoss);
  if (!dailyLossResult.passed) {
    return { outcome: "REJECTED", action: { type: "REJECT_ENTRY" }, violations: [dailyLossResult.violation!], evaluatedAt: input.asOf };
  }

  return {
    outcome: "ALLOWED",
    action: {
      type: "ALLOW_ENTRY",
      ...(entry.orderType !== undefined ? { orderType: entry.orderType } : {}),
      ...(entry.limitPrice !== undefined ? { limitPrice: entry.limitPrice } : {}),
      ...(entry.stopPrice !== undefined ? { stopPrice: entry.stopPrice } : {}),
    },
    violations: [],
    evaluatedAt: input.asOf,
  };
}

function evaluateManagement(
  input: RiskEvaluationInput,
  position: NonNullable<RiskEvaluationInput["existingPosition"]>,
): RiskEvaluationResult {
  const spec = input.riskSpecification;

  const holdingResult = evaluateMaxHoldingPeriod(spec, position, input.asOf);
  if (!holdingResult.passed) {
    return {
      outcome: "REJECTED",
      action: { type: "FORCE_EXIT_REQUIRED", reasonCode: "MAX_HOLDING_PERIOD" },
      violations: [holdingResult.violation!],
      evaluatedAt: input.asOf,
    };
  }

  if (spec.breakeven) {
    const be = evaluateBreakeven(spec.breakeven, input.direction, position.entryPrice, position.currentPrice, position.currentAtr, position.currentStopLoss);
    if (be.violation) {
      return { outcome: "REJECTED", action: { type: "NO_ACTION" }, violations: [be.violation], evaluatedAt: input.asOf };
    }
    if (be.triggered) {
      return { outcome: "MODIFIED", action: { type: "MOVE_STOP", newStopPrice: be.newStopPrice!, sourceRule: "BREAKEVEN" }, violations: [], evaluatedAt: input.asOf };
    }
  }

  if (spec.trailingStop) {
    const tr = evaluateTrailingStop(spec.trailingStop, input.direction, position.entryPrice, position.currentPrice, position.currentStopLoss, position.currentAtr);
    if (tr.violation) {
      return { outcome: "REJECTED", action: { type: "NO_ACTION" }, violations: [tr.violation], evaluatedAt: input.asOf };
    }
    if (tr.triggered) {
      return { outcome: "MODIFIED", action: { type: "MOVE_STOP", newStopPrice: tr.newStopPrice!, sourceRule: "TRAILING" }, violations: [], evaluatedAt: input.asOf };
    }
  }

  if (spec.partialClose) {
    const pc = evaluatePartialClose(
      spec.partialClose,
      input.direction,
      position.entryPrice,
      position.currentPrice,
      position.currentAtr,
      position.partialCloseAlreadyTriggered ?? false,
    );
    if (pc.violation) {
      return { outcome: "REJECTED", action: { type: "NO_ACTION" }, violations: [pc.violation], evaluatedAt: input.asOf };
    }
    if (pc.triggered) {
      return { outcome: "MODIFIED", action: { type: "PARTIAL_CLOSE", closePercent: pc.closePercent! }, violations: [], evaluatedAt: input.asOf };
    }
  }

  return { outcome: "ALLOWED", action: { type: "NO_ACTION" }, violations: [], evaluatedAt: input.asOf };
}
