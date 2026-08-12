// lib/chart-engine/candle-normalizer.ts
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation, Phase 17 (candle
// data-integrity validation). The ONE place raw provider Candle[]
// (types/market-candle.ts, oldest-first) becomes the chart engine's own
// ChartCandle[]. Never "repairs" a bad candle - a candle failing any check
// is dropped and counted in `rejectedCount`, reported honestly to the
// caller (see types/chart-data.ts#ChartSeries) rather than silently
// disappearing or being clamped into looking valid.
import type { Candle } from "@/types/market-candle";
import type { ChartCandle } from "@/types/chart-data";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface NormalizeCandlesResult {
  /** Oldest-first, integrity-validated. */
  candles: ChartCandle[];
  /** Count of raw candles dropped for failing a check below - never silently absorbed into `candles`. */
  rejectedCount: number;
}

/**
 * Validation rules, all deterministic and non-repairing:
 *  - open/high/low/close must each be a finite real number (rejects
 *    NaN/Infinity/undefined/missing OHLC in one check).
 *  - high >= low.
 *  - open and close must both fall within [low, high] (an OHLC candle
 *    whose body escapes its own wick range is structurally invalid).
 *  - datetime must parse to a finite epoch timestamp.
 *  - each ACCEPTED candle's time must be strictly greater than the
 *    previous accepted candle's time - this single rule rejects duplicate
 *    timestamps AND out-of-order candles without a separate sort/dedupe
 *    pass that could silently reorder genuinely bad data into looking
 *    clean (the chart engine's coordinate system assumes chronological,
 *    strictly-increasing time - see coordinate-system.ts).
 *  - volume, when present, must be a finite, non-negative number; an
 *    invalid volume drops only that field (never the whole candle) -
 *    OHLC is what a candlestick chart actually plots, and Candle's own
 *    contract already treats a missing volume as honest, not fabricated.
 */
export function normalizeCandles(raw: Candle[]): NormalizeCandlesResult {
  const candles: ChartCandle[] = [];
  let rejectedCount = 0;
  let lastTime = -Infinity;

  for (const c of raw) {
    const time = Date.parse(c.datetime);
    const ok =
      Number.isFinite(time) &&
      isFiniteNumber(c.open) &&
      isFiniteNumber(c.high) &&
      isFiniteNumber(c.low) &&
      isFiniteNumber(c.close) &&
      c.high >= c.low &&
      c.open >= c.low &&
      c.open <= c.high &&
      c.close >= c.low &&
      c.close <= c.high &&
      time > lastTime;

    if (!ok) {
      rejectedCount += 1;
      continue;
    }

    const volume = isFiniteNumber(c.volume) && (c.volume as number) >= 0 ? c.volume : undefined;
    candles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume });
    lastTime = time;
  }

  return { candles, rejectedCount };
}
