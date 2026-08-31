/**
 * Q0.9 Part 5, expanded in Q1.0 Parts 5/6/11/12, superseded in Q1.1 by
 * the full coverage-policy engine (coveragePolicy.ts::assessCoverage()).
 * Symbol/timeframe validity still comes from the single shared
 * capability contract (data/quant-lite-capability.ts); the date-range
 * decision itself now delegates entirely to assessCoverage(), which
 * returns one of four outcomes (SUPPORTED / SUPPORTED_WITH_WARNING /
 * RESTRICTED / DATA_UNAVAILABLE, Q1.1.6) computed against the real gap
 * registry rather than a single whole-range membership check. Only
 * DATA_UNAVAILABLE blocks the request here - RESTRICTED and
 * SUPPORTED_WITH_WARNING both proceed, carrying their assessment through
 * into the job record and result provenance (Q1.1.21).
 */
import { QUANT_LITE_CAPABILITY } from "@/data/quant-lite-capability";
import { assessCoverage } from "./coveragePolicy";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";

export const REAL_EXECUTION_SYMBOLS = new Set(QUANT_LITE_CAPABILITY.map((c) => c.symbol));

export interface CoverageCheckResult {
  ok: boolean;
  code?: "INVALID_SYMBOL" | "INVALID_TIMEFRAME" | "DATA_UNAVAILABLE";
  message?: string;
  /** Always set when ok === true (and also on a DATA_UNAVAILABLE date-range rejection, for full transparency) - the complete server-authoritative assessment. */
  assessment?: CoverageAssessment;
}

export function checkDataCoverage(symbol: string, timeframe: string, start: string, end: string): CoverageCheckResult {
  const entry = QUANT_LITE_CAPABILITY.find((c) => c.symbol === symbol);
  if (!entry) {
    return {
      ok: false,
      code: "INVALID_SYMBOL",
      message: `'${symbol}' is not a verified real-execution symbol. Supported: ${QUANT_LITE_CAPABILITY.map((c) => c.symbol).join(", ")}.`,
    };
  }
  if (!entry.timeframes.includes(timeframe)) {
    return {
      ok: false,
      code: "INVALID_TIMEFRAME",
      message: `'${timeframe}' signal timeframe is not verified for ${entry.label}. Supported for this symbol: ${entry.timeframes.join(", ")}.`,
    };
  }

  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
    return { ok: false, code: "DATA_UNAVAILABLE", message: "Start/end date could not be parsed." };
  }
  if (new Date(start) >= new Date(end)) {
    return { ok: false, code: "DATA_UNAVAILABLE", message: "Start date must be before end date." };
  }

  const assessment = assessCoverage(symbol, timeframe, start, end);
  if (assessment.policy === "DATA_UNAVAILABLE") {
    return { ok: false, code: "DATA_UNAVAILABLE", message: assessment.message, assessment };
  }
  return { ok: true, assessment };
}
