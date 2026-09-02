// services/algo-test/historical-data/validate-bars.ts
// P3.2A Blocker 2 - historical data validation, per the sprint's explicit
// checklist: timestamp[n] < timestamp[n+1]; high >= max(open, close);
// low <= min(open, close); high >= low; duplicate timestamps; symbol
// mismatch; timeframe mismatch. Invalid bars are REJECTED, never
// silently fabricated or silently dropped without a record - every
// rejection is returned to the caller.
import type { Instrument, OHLCVBar, Timeframe } from "at24-quant-engine";
import type { BarRejection } from "./types";

export interface ValidateBarsResult {
  /** In original order, minus any rejected bars. */
  validBars: readonly OHLCVBar[];
  rejected: readonly BarRejection[];
}

/**
 * Validates a raw, already-normalized bar sequence for one symbol/timeframe.
 * Does NOT fabricate missing bars for real market gaps (weekends, holidays,
 * feed outages) - a gap is legitimate and left as-is; only duplicate
 * timestamps, out-of-order timestamps, and internally-inconsistent OHLC
 * values are rejected.
 */
export function validateBars(bars: readonly OHLCVBar[], expected: { instrument: Instrument; timeframe: Timeframe }): ValidateBarsResult {
  const validBars: OHLCVBar[] = [];
  const rejected: BarRejection[] = [];
  const seenTimestamps = new Set<number>();
  let previousTimestamp: number | undefined;

  for (const bar of bars) {
    if (bar.instrument.symbol !== expected.instrument.symbol) {
      rejected.push({ reason: "SYMBOL_MISMATCH", detail: `expected symbol '${expected.instrument.symbol}', got '${bar.instrument.symbol}'`, timestamp: bar.timestamp });
      continue;
    }
    if (bar.timeframe !== expected.timeframe) {
      rejected.push({ reason: "TIMEFRAME_MISMATCH", detail: `expected timeframe '${expected.timeframe}', got '${bar.timeframe}'`, timestamp: bar.timestamp });
      continue;
    }
    if (seenTimestamps.has(bar.timestamp)) {
      rejected.push({ reason: "DUPLICATE_TIMESTAMP", detail: `timestamp ${bar.timestamp} appears more than once`, timestamp: bar.timestamp });
      continue;
    }
    if (previousTimestamp !== undefined && bar.timestamp <= previousTimestamp) {
      rejected.push({ reason: "OUT_OF_ORDER", detail: `timestamp ${bar.timestamp} does not strictly increase from previous ${previousTimestamp}`, timestamp: bar.timestamp });
      continue;
    }
    const invalidOhlcReason = describeInvalidOhlc(bar);
    if (invalidOhlcReason) {
      rejected.push({ reason: "INVALID_OHLC", detail: invalidOhlcReason, timestamp: bar.timestamp });
      continue;
    }

    seenTimestamps.add(bar.timestamp);
    previousTimestamp = bar.timestamp;
    validBars.push(bar);
  }

  return { validBars, rejected };
}

function describeInvalidOhlc(bar: OHLCVBar): string | undefined {
  const { open, high, low, close } = bar;
  if (![open, high, low, close].every((v) => Number.isFinite(v))) {
    return `non-finite OHLC value (open=${open}, high=${high}, low=${low}, close=${close})`;
  }
  if (high < low) {
    return `high (${high}) < low (${low})`;
  }
  if (high < Math.max(open, close)) {
    return `high (${high}) < max(open, close) = ${Math.max(open, close)}`;
  }
  if (low > Math.min(open, close)) {
    return `low (${low}) > min(open, close) = ${Math.min(open, close)}`;
  }
  if (bar.volume < 0) {
    return `negative volume (${bar.volume})`;
  }
  return undefined;
}
