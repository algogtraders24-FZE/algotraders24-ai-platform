// lib/chart-engine/time-axis.ts
// Sprint D2.7.2, Phase 10 - deterministic time axis tick generation,
// reusing the platform's EXISTING SignalTimeframe union (types/signal.ts)
// - never a second timeframe classification. Every tick is placed AT a
// real candle's own timestamp, never a synthesized time between candles,
// so the axis can never display a moment the market data doesn't actually
// have.
import type { ChartCandle } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";
import type { Viewport } from "./types";

const TARGET_TICK_COUNT = 6;

// Sub-day timeframes read best as a bare clock time ("14:30"); day+
// timeframes read best as a date ("Aug 12") - reuses lib/financial-
// format.ts#formatTimestamp's own "time"/"date" granularity split.
const INTRADAY_TIMEFRAMES: ReadonlySet<SignalTimeframe> = new Set(["1m", "5m", "15m", "30m", "1h", "4h"]);

export interface TimeAxisTick {
  time: number;
  /** Index into the full candle array - the renderer positions the tick at that candle's real x, never an interpolated x. */
  index: number;
  granularity: "time" | "date";
}

export function timeAxisGranularity(timeframe: SignalTimeframe): "time" | "date" {
  return INTRADAY_TIMEFRAMES.has(timeframe) ? "time" : "date";
}

// Sprint D2.7.6, Phase 6 - professionalization. The original fixed
// TARGET_TICK_COUNT (6) was correct for a typical desktop plot width but
// could crowd on a narrow (mobile-width) chart and under-label a very wide
// one. MIN_TIME_TICK_SPACING_PX is a generous estimate for a short label
// ("14:30"/"Aug 12" at 11px mono) plus breathing room.
const MIN_TIME_TICK_SPACING_PX = 70;
const MIN_TIME_TICK_COUNT = 2;
const MAX_TIME_TICK_COUNT = 8;

/** Derives a sensible tick count from the plot's real pixel width - never overlaps on narrow viewports, never under-labels a wide one. Callers pass the result into `computeTimeTicks`'s existing `targetCount` param; omitting it preserves the original fixed-6 behavior. */
export function targetTimeTickCountForWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return TARGET_TICK_COUNT;
  const count = Math.floor(widthPx / MIN_TIME_TICK_SPACING_PX);
  return Math.min(MAX_TIME_TICK_COUNT, Math.max(MIN_TIME_TICK_COUNT, count));
}

export interface PeriodSeparator {
  /** Index into the candle array of the FIRST candle of a new UTC calendar day - the renderer positions the separator line at that candle's real x. */
  index: number;
}

/**
 * Sprint D2.7.11 Phase 5b - MT5's "Show period separators" (a vertical line
 * at each new trading day, right-click chart menu / Properties dialog).
 * Deliberately scoped to INTRADAY timeframes only, matching real MT5 (on a
 * D1+ chart, one bar already IS a whole day - a same-scale "day boundary"
 * line there would be redundant with every single bar). Never fabricates a
 * separator for a timeframe where the concept doesn't honestly apply.
 */
export function computePeriodSeparators(candles: ChartCandle[], timeframe: SignalTimeframe): PeriodSeparator[] {
  if (!INTRADAY_TIMEFRAMES.has(timeframe)) return [];
  const MS_PER_DAY = 86_400_000;
  const separators: PeriodSeparator[] = [];
  let lastDay: number | null = null;
  for (let index = 0; index < candles.length; index++) {
    const day = Math.floor(candles[index].time / MS_PER_DAY);
    if (lastDay !== null && day !== lastDay) separators.push({ index });
    lastDay = day;
  }
  return separators;
}

/** Up to `targetCount` evenly spaced real candles from the visible window. Returns an empty array when nothing is visible (never fabricates a tick). */
export function computeTimeTicks(
  candles: ChartCandle[],
  viewport: Viewport,
  timeframe: SignalTimeframe,
  targetCount = TARGET_TICK_COUNT,
): TimeAxisTick[] {
  const visible: { time: number; index: number }[] = [];
  for (let index = 0; index < candles.length; index++) {
    const time = candles[index].time;
    if (time >= viewport.minTime && time <= viewport.maxTime) visible.push({ time, index });
  }
  if (visible.length === 0) return [];

  const granularity = timeAxisGranularity(timeframe);
  const stride = Math.max(1, Math.floor(visible.length / targetCount));
  const ticks: TimeAxisTick[] = [];
  for (let i = 0; i < visible.length; i += stride) {
    ticks.push({ time: visible[i].time, index: visible[i].index, granularity });
  }
  return ticks;
}
