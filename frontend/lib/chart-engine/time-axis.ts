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
