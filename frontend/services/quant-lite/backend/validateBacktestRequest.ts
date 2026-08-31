/**
 * Q0.9 Part 4 - authoritative server-side validation. Mirrors
 * quant-engine/spec_engine/schema.py::validate_spec() rule-for-rule (the
 * Python side re-validates independently before ever touching the engine
 * - this is defense in depth for a fast 400 response, not the only
 * check) plus request-shape rules schema.py doesn't own (symbol/
 * timeframe/date range/capital/risk%). validateStrategySpec.ts
 * (client-side, Q0.8) is usability-only and is NOT reused here on
 * purpose - a client cannot be trusted to have run it.
 */
import { SUPPORTED_CONDITION_OPS, SUPPORTED_INDICATOR_TYPES } from "@/types/quant-lite";
import type { BacktestRequest } from "@/types/quant-lite";
import { checkDataCoverage } from "./dataCoverage";

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

const MIN_CAPITAL = 100;
const MAX_CAPITAL = 10_000_000;
const MIN_RISK_PCT = 0.1;
const MAX_RISK_PCT = 10;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateIndicator(ind: unknown, errors: string[]) {
  if (!isPlainObject(ind)) {
    errors.push("indicator entry must be an object");
    return;
  }
  if (typeof ind.id !== "string" || !ind.id) errors.push(`indicator missing 'id': ${JSON.stringify(ind)}`);
  if (!SUPPORTED_INDICATOR_TYPES.includes(ind.type as (typeof SUPPORTED_INDICATOR_TYPES)[number])) {
    errors.push(`unknown indicator type: ${String(ind.type)}`);
  }
}

function validateCondition(cond: unknown, group: string, errors: string[]) {
  if (!isPlainObject(cond)) {
    errors.push(`${group} entry must be an object`);
    return;
  }
  if (!SUPPORTED_CONDITION_OPS.includes(cond.op as (typeof SUPPORTED_CONDITION_OPS)[number])) {
    errors.push(`unknown op in ${group}: ${String(cond.op)}`);
  }
  if (cond.left === undefined || cond.right === undefined) {
    errors.push(`${group} condition missing left/right: ${JSON.stringify(cond)}`);
  }
}

/** Same shape schema.py::validate_spec returns, ported rule-for-rule. */
export function validateStrategySpecServerSide(strategy: BacktestRequest["strategy"]): string[] {
  const errors: string[] = [];
  if (!strategy || !Array.isArray(strategy.indicators)) {
    return ["missing 'indicators'"];
  }

  const idsByType = new Map<string, string>();
  for (const ind of strategy.indicators as unknown[]) {
    validateIndicator(ind, errors);
    if (isPlainObject(ind) && typeof ind.id === "string") idsByType.set(ind.id, String(ind.type));
  }

  for (const [group, list] of [
    ["entry_long", strategy.entry_long],
    ["entry_short", strategy.entry_short],
  ] as const) {
    if (!Array.isArray(list)) {
      errors.push(`'${group}' must be an array`);
      continue;
    }
    for (const cond of list as unknown[]) validateCondition(cond, group, errors);
  }

  if ((strategy.entry_long?.length ?? 0) === 0 && (strategy.entry_short?.length ?? 0) === 0) {
    errors.push("strategy has no entry_long or entry_short conditions - it can never trade");
  }

  const risk = strategy.risk;
  if (!isPlainObject(risk)) {
    errors.push("missing 'risk'");
  } else {
    for (const modeKey of ["sl_mode", "tp_mode"] as const) {
      if (risk[modeKey] !== "ATR") continue;
      const atrId = risk.atr_id;
      if (!atrId || typeof atrId !== "string") {
        errors.push(`risk.${modeKey}=ATR needs risk.atr_id pointing at an ATR indicator`);
      } else if (idsByType.get(atrId) !== "ATR") {
        errors.push(`risk.atr_id '${atrId}' does not refer to an ATR-type indicator in 'indicators'`);
      }
    }
    if (risk.sl_mode !== "ATR" && risk.sl_mode !== "PIPS") errors.push(`invalid risk.sl_mode: ${String(risk.sl_mode)}`);
    if (risk.tp_mode !== "ATR" && risk.tp_mode !== "PIPS") errors.push(`invalid risk.tp_mode: ${String(risk.tp_mode)}`);
  }

  return errors;
}

export function validateBacktestRequest(body: unknown): ValidationOutcome {
  const errors: string[] = [];

  if (!isPlainObject(body)) {
    return { valid: false, errors: ["request body must be a JSON object"] };
  }

  const { strategy, symbol, timeframe, dateRange, initialCapital, riskPct } = body as Partial<BacktestRequest>;

  if (typeof symbol !== "string" || !symbol) errors.push("symbol is required");
  if (typeof timeframe !== "string" || !timeframe) errors.push("timeframe is required");

  if (!isPlainObject(dateRange) || typeof dateRange.start !== "string" || typeof dateRange.end !== "string") {
    errors.push("dateRange.start and dateRange.end are required");
  } else if (symbol && timeframe) {
    const coverage = checkDataCoverage(symbol, timeframe, dateRange.start, dateRange.end);
    if (!coverage.ok) errors.push(coverage.message ?? "requested data is not available");
  }

  if (typeof initialCapital !== "number" || !Number.isFinite(initialCapital) || initialCapital < MIN_CAPITAL || initialCapital > MAX_CAPITAL) {
    errors.push(`initialCapital must be a number between ${MIN_CAPITAL} and ${MAX_CAPITAL}`);
  }
  if (typeof riskPct !== "number" || !Number.isFinite(riskPct) || riskPct < MIN_RISK_PCT || riskPct > MAX_RISK_PCT) {
    errors.push(`riskPct must be a number between ${MIN_RISK_PCT} and ${MAX_RISK_PCT}`);
  }

  if (!strategy) {
    errors.push("strategy is required");
  } else {
    errors.push(...validateStrategySpecServerSide(strategy as BacktestRequest["strategy"]));
  }

  return { valid: errors.length === 0, errors };
}
