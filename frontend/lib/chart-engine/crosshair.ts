// lib/chart-engine/crosshair.ts
// Sprint D2.7.2, Phase 8 - crosshair foundation: nearest-candle lookup only.
// Never interpolates a synthetic OHLC value between two real candles - the
// crosshair always snaps to and reports an actual traded candle.
//
// Gapless x-axis (this session) - the crosshair's pixel->candle lookup now
// goes through index-scale.ts, the SAME index-domain math renderer.ts uses
// to actually POSITION every candle on screen. This is not just consistent
// with the visual fix - it's genuinely simpler than the previous time-
// domain binary search: a pixel x maps directly and cheaply to a
// fractional index (one division), which just needs rounding + clamping
// to become the nearest real candle - no bracketing/nearest-of-two-
// candidates search required at all.
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { indexRangeForViewport, xToIndex } from "./index-scale";

/** The real candle index nearest a pixel x position. Returns -1 for an empty series. */
export function nearestCandleIndex(candles: ChartCandle[], viewport: Viewport, xPixel: number, plotWidth: number): number {
  if (candles.length === 0) return -1;
  const range = indexRangeForViewport(candles, viewport);
  const fractional = xToIndex(xPixel, range, plotWidth);
  return Math.max(0, Math.min(candles.length - 1, Math.round(fractional)));
}
