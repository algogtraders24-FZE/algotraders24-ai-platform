// lib/market-data/candle-validation.ts
// Sprint D2.8.15 - Intelligence Data Sufficiency, Evidence-State
// Reconciliation & Production Intelligence Remediation, Phase 3.
//
// Before any technical indicator is computed, a real candle array can
// still be structurally malformed - a provider bug, a transport glitch, a
// duplicate/out-of-order response. This module validates a candle array
// and separates it into (a) the real, usable candles and (b) an explicit,
// never-silent list of what was rejected and why. It NEVER repairs a bad
// row (no interpolation, no clamping, no re-sorting that would silently
// "fix" a provider's own ordering bug) - a malformed row is dropped, not
// guessed into something usable, matching every other D2.x validation
// module's own discipline (lib/microstructure/microstructure-validation.ts,
// services/market-data/market-snapshot-integrity.service.ts).
import type { Candle } from "@/types/market-candle";

export const CANDLE_VALIDATION_VERSION = "1.0.0";

export type CandleIssueType =
  | "duplicate-timestamp"
  | "out-of-order"
  | "missing-timestamp"
  | "future-timestamp"
  | "invalid-ohlc"
  | "non-positive-price"
  | "negative-volume";

export interface CandleValidationIssue {
  type: CandleIssueType;
  index: number;
  datetime: string;
  detail: string;
}

export interface CandleValidationResult {
  /** The real, structurally-valid candles, in their original (oldest-first) relative order - never re-sorted, never repaired. */
  validCandles: Candle[];
  /** Every rejected/flagged row, with an honest reason - never silently dropped without a record. */
  issues: CandleValidationIssue[];
  totalReceived: number;
  totalValid: number;
}

/** A small, fixed tolerance for "now" - mirrors D2.8.5's own FUTURE_TIMESTAMP_TOLERANCE_MS convention (microstructure-validation.ts) rather than inventing a second one. */
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5_000;

function isValidOhlc(c: Candle): boolean {
  const { open, high, low, close } = c;
  if (![open, high, low, close].every((v) => Number.isFinite(v))) return false;
  if ([open, high, low, close].some((v) => v <= 0)) return false;
  if (high < low) return false;
  if (open > high || open < low) return false;
  if (close > high || close < low) return false;
  return true;
}

/**
 * Pure, deterministic: identical candles + identical nowMs always produce
 * an identical result. Duplicate timestamps and out-of-order rows are
 * detected relative to the PREVIOUS already-accepted candle, so a single
 * bad row never cascades into rejecting every row after it.
 */
export function validateCandles(candles: readonly Candle[], nowMs: number): CandleValidationResult {
  const issues: CandleValidationIssue[] = [];
  const validCandles: Candle[] = [];
  let lastAcceptedMs: number | undefined;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    if (!c.datetime) {
      issues.push({ type: "missing-timestamp", index: i, datetime: "", detail: "Candle has no datetime field." });
      continue;
    }
    const ms = Date.parse(c.datetime);
    if (Number.isNaN(ms)) {
      issues.push({ type: "missing-timestamp", index: i, datetime: c.datetime, detail: `Candle datetime "${c.datetime}" could not be parsed.` });
      continue;
    }
    if (ms > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS) {
      issues.push({ type: "future-timestamp", index: i, datetime: c.datetime, detail: `Candle timestamp is ${ms - nowMs}ms in the future.` });
      continue;
    }
    if (!isValidOhlc(c)) {
      issues.push({ type: "invalid-ohlc", index: i, datetime: c.datetime, detail: `Malformed OHLC (open=${c.open}, high=${c.high}, low=${c.low}, close=${c.close}) - non-finite, non-positive, or high<low/open-close outside [low,high].` });
      continue;
    }
    if (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0)) {
      issues.push({ type: "negative-volume", index: i, datetime: c.datetime, detail: `Volume (${c.volume}) is negative or non-finite.` });
      continue;
    }
    if (lastAcceptedMs !== undefined && ms === lastAcceptedMs) {
      issues.push({ type: "duplicate-timestamp", index: i, datetime: c.datetime, detail: "Duplicate timestamp of the previously-accepted candle." });
      continue;
    }
    if (lastAcceptedMs !== undefined && ms < lastAcceptedMs) {
      issues.push({ type: "out-of-order", index: i, datetime: c.datetime, detail: `Timestamp is earlier than the previously-accepted candle (${new Date(lastAcceptedMs).toISOString()}) - candles must be oldest-first.` });
      continue;
    }

    validCandles.push(c);
    lastAcceptedMs = ms;
  }

  return { validCandles, issues, totalReceived: candles.length, totalValid: validCandles.length };
}
