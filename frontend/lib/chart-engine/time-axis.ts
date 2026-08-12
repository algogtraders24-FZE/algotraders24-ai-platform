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
