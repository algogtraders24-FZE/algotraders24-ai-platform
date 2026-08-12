// lib/chart-engine/candle-index.ts
// Sprint D2.7.3, Phase 3 - deterministic candle lookup helpers. Every
// function here assumes its input is already normalized (candle-
// normalizer.ts's own contract: oldest-first, strictly-increasing time) -
// this module does no validation of its own, it only indexes. Binary
// search (not a linear scan) is used for the two lookups the crosshair
// calls on every `mousemove` - Phase 12's performance requirement that
// the crosshair stay responsive at up to 5,000 candles.
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";

/**
 * Index of the candle whose `time` is closest to `targetTime`, via binary
 * search over the (guaranteed sorted) array - O(log n) instead of the O(n)
 * linear scan a naive "closest of N" search would need. Returns -1 for an
 * empty array. Never interpolates a synthetic candle between two real
 * ones - always returns a real index.
 */
export function nearestIndexByTime(candles: readonly ChartCandle[], targetTime: number): number {
  if (candles.length === 0) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  if (targetTime <= candles[0].time) return 0;
  if (targetTime >= candles[hi].time) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time === targetTime) return mid;
    if (candles[mid].time < targetTime) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first index with time >= targetTime; compare it against its
  // predecessor to find the genuinely closest of the two candidates.
  const before = candles[lo - 1];
  const after = candles[lo];
  if (!before) return lo;
  return targetTime - before.time <= after.time - targetTime ? lo - 1 : lo;
}

/** The first index with time >= `minTime` (binary search, lower bound). */
export function lowerBoundByTime(candles: readonly ChartCandle[], minTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < minTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last index with time <= `maxTime` (binary search, upper bound). Returns -1 when every candle is after maxTime. */
export function upperBoundByTime(candles: readonly ChartCandle[], maxTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= maxTime) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export interface VisibleWindow {
  /** Inclusive start index into the full candle array, or -1 when nothing is visible. */
  startIndex: number;
  /** Inclusive end index into the full candle array, or -1 when nothing is visible. */
  endIndex: number;
}

/** The real candle index range visible within a viewport's [minTime, maxTime] - the one shared definition every renderer/axis/indicator-overlay module should use instead of re-filtering the array independently. */
export function visibleWindow(candles: readonly ChartCandle[], viewport: Viewport): VisibleWindow {
  if (candles.length === 0) return { startIndex: -1, endIndex: -1 };
  const startIndex = lowerBoundByTime(candles, viewport.minTime);
  const endIndex = upperBoundByTime(candles, viewport.maxTime);
  if (startIndex >= candles.length || endIndex < 0 || startIndex > endIndex) return { startIndex: -1, endIndex: -1 };
  return { startIndex, endIndex };
}

/** The most recent candle, or undefined for an empty series. */
export function latestCandle(candles: readonly ChartCandle[]): ChartCandle | undefined {
  return candles.length > 0 ? candles[candles.length - 1] : undefined;
}

/** The exact candle at a given time, or undefined when no candle has that exact timestamp (never a nearest-match fallback - callers that want "closest" should use nearestIndexByTime explicitly). */
export function candleAtExactTime(candles: readonly ChartCandle[], time: number): ChartCandle | undefined {
  const index = lowerBoundByTime(candles, time);
  return candles[index]?.time === time ? candles[index] : undefined;
}
