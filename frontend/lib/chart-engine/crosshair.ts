// lib/chart-engine/crosshair.ts
// Sprint D2.7.2, Phase 8 - crosshair foundation: nearest-candle lookup only.
// Never interpolates a synthetic OHLC value between two real candles - the
// crosshair always snaps to and reports an actual traded candle.
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { xToTime } from "./coordinate-system";

/** The real candle index nearest a pixel x position. Returns -1 for an empty series. */
export function nearestCandleIndex(candles: ChartCandle[], viewport: Viewport, xPixel: number, plotWidth: number): number {
  if (candles.length === 0) return -1;
  const targetTime = xToTime(xPixel, viewport, plotWidth);
  let closestIndex = 0;
  let closestDelta = Math.abs(candles[0].time - targetTime);
  for (let i = 1; i < candles.length; i++) {
    const delta = Math.abs(candles[i].time - targetTime);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIndex = i;
    }
  }
  return closestIndex;
}
