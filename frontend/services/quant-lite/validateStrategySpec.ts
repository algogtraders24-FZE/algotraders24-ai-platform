/**
 * Client-side validation for usability only (Q0.7 Part 7 / Q0.8 Part 7).
 * The backend's schema.py::validate_spec() remains authoritative - this
 * does not duplicate its full logic, it catches obvious, cheap mistakes
 * before a request is ever made.
 */
import {
  SUPPORTED_INDICATOR_TYPES,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  type StrategySpec,
  type ValidationResult,
} from "@/types/quant-lite";

export function validateStrategySpec(spec: Partial<StrategySpec>): ValidationResult {
  const errors: string[] = [];

  if (!spec.name || spec.name.trim().length === 0) {
    errors.push("Strategy name is required.");
  }

  if (!spec.symbol || !SUPPORTED_SYMBOLS.includes(spec.symbol as never)) {
    errors.push("Please select a supported market.");
  }

  if (!spec.timeframe || !SUPPORTED_TIMEFRAMES.includes(spec.timeframe as never)) {
    errors.push("Please select a supported timeframe.");
  }

  if (!spec.indicators || spec.indicators.length === 0) {
    errors.push("Add at least one indicator.");
  } else {
    for (const ind of spec.indicators) {
      if (!SUPPORTED_INDICATOR_TYPES.includes(ind.type as never)) {
        errors.push(`Unsupported indicator type: ${ind.type}`);
      }
      if (!ind.id || ind.id.trim().length === 0) {
        errors.push("Every indicator needs a unique ID.");
      }
    }
  }

  const hasLong = spec.entry_long && spec.entry_long.length > 0;
  const hasShort = spec.entry_short && spec.entry_short.length > 0;
  if (!hasLong && !hasShort) {
    errors.push("Add at least one entry condition (buy or sell).");
  }

  if (!spec.risk) {
    errors.push("Risk settings are required.");
  } else {
    if (spec.risk.sl_mode === "ATR" && !spec.risk.atr_id) {
      errors.push("ATR-based stop loss needs an ATR indicator selected.");
    }
    if (spec.risk.sl_mode === "PIPS" && (spec.risk.sl_points === undefined || spec.risk.sl_points <= 0)) {
      errors.push("Stop loss distance must be greater than zero.");
    }
    if (spec.risk.tp_mode === "PIPS" && (spec.risk.tp_points === undefined || spec.risk.tp_points <= 0)) {
      errors.push("Take profit distance must be greater than zero.");
    }
    if (spec.risk.sl_mode === "ATR" && (spec.risk.sl_atr_mult === undefined || spec.risk.sl_atr_mult <= 0)) {
      errors.push("Stop loss ATR multiplier must be greater than zero.");
    }
    if (spec.risk.tp_mode === "ATR" && (spec.risk.tp_atr_mult === undefined || spec.risk.tp_atr_mult <= 0)) {
      errors.push("Take profit ATR multiplier must be greater than zero.");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRiskPct(riskPct: number): string | null {
  if (Number.isNaN(riskPct) || riskPct <= 0) return "Risk % must be greater than zero.";
  if (riskPct > 10) return "Risk % above 10 is not allowed in Quant Lite.";
  return null;
}

export function validateInitialCapital(capital: number): string | null {
  if (Number.isNaN(capital) || capital <= 0) return "Initial capital must be greater than zero.";
  return null;
}

export function validateDateRange(
  start: string,
  end: string,
  coverage: { start: string; end: string },
): string | null {
  if (!start || !end) return "Please select a start and end date.";
  if (new Date(start) >= new Date(end)) return "Start date must be before end date.";
  if (new Date(start) < new Date(coverage.start) || new Date(end) > new Date(coverage.end)) {
    return `Historical data for this market is only available from ${coverage.start} to ${coverage.end}.`;
  }
  return null;
}
