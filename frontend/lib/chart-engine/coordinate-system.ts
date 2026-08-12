// lib/chart-engine/coordinate-system.ts
// Sprint D2.7.2, Phase 6 - deterministic price<->pixel and time<->pixel
// conversions. Pure functions only: no DOM, no React, no mutation, no
// accumulated state - every conversion is computed fresh from the
// viewport's own absolute bounds each call, so repeated pan/zoom
// interactions never accumulate floating-point drift the way an
// incremental "add a delta to the last position" approach would.
import type { Viewport } from "./types";

/** Real price -> pixel Y within the plot area (0 = top). Price axis is inverted (higher price = smaller y), the standard chart convention. */
export function priceToY(price: number, viewport: Viewport, plotHeight: number): number {
  const { minPrice, maxPrice } = viewport;
  if (maxPrice === minPrice || plotHeight <= 0) return plotHeight / 2;
  const ratio = (price - minPrice) / (maxPrice - minPrice);
  return plotHeight - ratio * plotHeight;
}

/** Pixel Y -> real price - the exact inverse of priceToY. */
export function yToPrice(y: number, viewport: Viewport, plotHeight: number): number {
  const { minPrice, maxPrice } = viewport;
  if (plotHeight <= 0) return minPrice;
  const ratio = 1 - y / plotHeight;
  return minPrice + ratio * (maxPrice - minPrice);
}

/** Real epoch-ms time -> pixel X within the plot area (0 = left). */
export function timeToX(time: number, viewport: Viewport, plotWidth: number): number {
  const { minTime, maxTime } = viewport;
  if (maxTime === minTime || plotWidth <= 0) return plotWidth / 2;
  const ratio = (time - minTime) / (maxTime - minTime);
  return ratio * plotWidth;
}

/** Pixel X -> real epoch-ms time - the exact inverse of timeToX. */
export function xToTime(x: number, viewport: Viewport, plotWidth: number): number {
  const { minTime, maxTime } = viewport;
  if (plotWidth <= 0) return minTime;
  const ratio = x / plotWidth;
  return minTime + ratio * (maxTime - minTime);
}
