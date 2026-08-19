// lib/chart-engine/index-scale.ts
// Gapless horizontal axis. Real markets have real time gaps (weekend
// closures, missing bars) that a naive time-proportional x-axis renders
// as dead, empty canvas space between the surrounding candles - not how
// any professional charting platform (MT5 included) actually looks: a
// weekend gap or a missing hour takes exactly as much horizontal space
// as any other single candle-to-candle step, never more.
//
// Every candle is instead given a UNIFORM pixel slot by its own ARRAY
// INDEX, never by its raw elapsed real time from its neighbor - the
// standard "gapless"/session-aware charting technique every mainstream
// platform uses. The Viewport itself stays real-time-based everywhere
// else in this engine (pan/zoom semantics, "follow the last N candles",
// drawn-object anchoring/persistence in lib/chart-engine/drawing/*) -
// only the FINAL pixel position for something with a real time value
// goes through this module's index bridge. This is a deliberate,
// additive module: coordinate-system.ts's timeToX/xToTime are UNCHANGED
// and still correct for genuine time-domain math (viewport pan/zoom
// deltas) - this file is only ever used for the actual on-screen x
// position of a candle, tick, drawn object, or crosshair.
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { lowerBoundByTime } from "./candle-index";
import { candleStepMs } from "./viewport";

export interface IndexRange {
  minIndex: number;
  maxIndex: number;
}

/**
 * A real time -> fractional candle-index. For a time that falls exactly
 * between two real candles, interpolates using THEIR OWN real spacing
 * (so a value inside an oversized gap - e.g. a 60-hour weekend gap on a
 * 1h timeframe - still lands strictly between those two candles' indices,
 * e.g. 5.5, never extrapolated proportionally to the real 60 hours - that
 * proportional extrapolation is exactly what causes the visible gap this
 * module exists to eliminate). A time before the first or after the last
 * real candle extrapolates using the series' own real step
 * (candleStepMs) - needed for the small time padding fitToData/panning
 * already add past either edge.
 */
export function fractionalIndexForTime(candles: readonly ChartCandle[], time: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  const stepMs = candleStepMs(candles);
  if (time <= candles[0].time) {
    return stepMs > 0 ? (time - candles[0].time) / stepMs : 0;
  }
  const last = candles[n - 1];
  if (time >= last.time) {
    return stepMs > 0 ? n - 1 + (time - last.time) / stepMs : n - 1;
  }
  const idx = lowerBoundByTime(candles, time); // first index with time >= target
  const after = candles[idx];
  const before = candles[idx - 1];
  if (!before) return idx;
  const span = after.time - before.time;
  if (span <= 0) return idx - 1;
  return idx - 1 + (time - before.time) / span;
}

/** The inverse of fractionalIndexForTime - a fractional index back to a real time value. Used ONLY where a genuine real time value is needed FROM a pixel position (the crosshair's time readout, placing/dragging a drawn object) - never for positioning a candle/tick that already has a real index, which should call indexToX directly with that index. */
export function fractionalIndexToTime(candles: readonly ChartCandle[], index: number): number {
  const n = candles.length;
  if (n === 0) return Date.now();
  const stepMs = candleStepMs(candles);
  if (index <= 0) return candles[0].time + index * stepMs;
  if (index >= n - 1) return candles[n - 1].time + (index - (n - 1)) * stepMs;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return candles[lo].time;
  const frac = index - lo;
  return candles[lo].time + frac * (candles[hi].time - candles[lo].time);
}

/** The visible viewport's real [minTime, maxTime] bounds, expressed as a fractional candle-index range - the one bridge between the engine's real-time Viewport model and every gapless pixel-positioning function below. Compute this ONCE per render/interaction, never per-candle inside a loop. */
export function indexRangeForViewport(candles: readonly ChartCandle[], viewport: Viewport): IndexRange {
  if (candles.length === 0) return { minIndex: 0, maxIndex: 1 };
  return {
    minIndex: fractionalIndexForTime(candles, viewport.minTime),
    maxIndex: fractionalIndexForTime(candles, viewport.maxTime),
  };
}

/** A candle's own array index (or any fractional index) -> a gapless pixel x. The index-domain analog of coordinate-system.ts's timeToX - this is what actually eliminates the visual gap, since every unit of index is always the SAME pixel width regardless of how much real time that unit spanned. */
export function indexToX(index: number, range: IndexRange, plotWidth: number): number {
  const { minIndex, maxIndex } = range;
  if (maxIndex === minIndex || plotWidth <= 0) return plotWidth / 2;
  return ((index - minIndex) / (maxIndex - minIndex)) * plotWidth;
}

/** Pixel x -> fractional index - the exact inverse of indexToX. */
export function xToIndex(x: number, range: IndexRange, plotWidth: number): number {
  const { minIndex, maxIndex } = range;
  if (plotWidth <= 0) return minIndex;
  return minIndex + (x / plotWidth) * (maxIndex - minIndex);
}
