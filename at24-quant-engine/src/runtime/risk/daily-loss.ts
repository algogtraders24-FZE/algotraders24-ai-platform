import type { DailyLossContext, RiskConstraintResult } from "../../domain/risk-evaluation.js";
import type { RiskSpecification } from "../../domain/risk-specification.js";
import { makeViolation } from "./violations.js";

/**
 * Semantics (Q0.3.6, extending the field doc in risk-specification.ts):
 * counts REALIZED P&L only for the current trading day (unrealized/
 * floating P&L, and any fee/commission/financing NOT already netted into
 * the caller-supplied `realizedPnlToday`, are explicitly excluded — this
 * function does not re-derive P&L from trades, it trusts the caller's
 * number). Net PROFIT for the day does not "bank" against a later loss
 * (lossSoFar is clamped to >= 0, never negative) — a profitable day
 * followed by a loss is evaluated purely on that day's net figure.
 * `equityAtDayStart` (not live/current equity) is used for
 * percent-equity mode, so the day's loss target is fixed at the start of
 * the day, not a moving target as losses accrue.
 */
export function evaluateDailyLossLimit(spec: RiskSpecification, dailyLoss: DailyLossContext): RiskConstraintResult {
  const limit = spec.dailyLossLimit;
  if (limit === undefined) return { passed: true };

  const lossSoFar = Math.max(0, -dailyLoss.realizedPnlToday);
  const limitAmount = limit.mode === "fixed-amount" ? limit.amount : (limit.percent / 100) * dailyLoss.equityAtDayStart;

  if (lossSoFar >= limitAmount) {
    return {
      passed: false,
      violation: makeViolation(
        "DAILY_LOSS_LIMIT",
        "BLOCKING",
        `realized loss today (${lossSoFar}) >= configured limit (${limitAmount})`,
        lossSoFar,
        limitAmount,
        "AT_OR_BEYOND_LIMIT",
      ),
    };
  }
  return { passed: true };
}

/**
 * Pure day-boundary bucketing helper. `dayBoundaryOffsetMinutes` is an
 * explicit numeric UTC offset (e.g. -300 for a UTC-5 broker-day
 * convention), never the machine's local timezone — a future stateful
 * caller (e.g. a backtester) uses this to decide when to reset its own
 * `realizedPnlToday` accumulator to 0. evaluateDailyLossLimit() itself
 * does not call this — it stays a pure function of the already-bucketed
 * number the caller supplies (Q0.3.17 purity).
 */
export function computeTradingDayKey(timestampMs: number, dayBoundaryOffsetMinutes: number): string {
  const shifted = timestampMs + dayBoundaryOffsetMinutes * 60_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function isSameTradingDay(t1: number, t2: number, dayBoundaryOffsetMinutes: number): boolean {
  return computeTradingDayKey(t1, dayBoundaryOffsetMinutes) === computeTradingDayKey(t2, dayBoundaryOffsetMinutes);
}
