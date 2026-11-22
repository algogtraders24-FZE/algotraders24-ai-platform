// lib/chart-engine/drawing/snap.ts
// Magnet: snap a drawing point to the open / high / low / close of the candle under the pointer when one of them is within
// `thresholdPx` of the pointer (vertical distance). Otherwise the point is left exactly where it is.
import type { ChartCandle } from "@/types/chart-data";
import type { DrawingPoint } from "./types";

export const SNAP_THRESHOLD_PX = 14;

/**
 * @param fractionalIndex the pointer's x as a fractional candle index (index-scale xToIndex)
 * @param pointerY the pointer's y inside the price row, in pixels
 * @param priceToPx maps a price to a y pixel inside the same row
 */
export function snapToOhlc(
  candles: readonly ChartCandle[],
  point: DrawingPoint,
  fractionalIndex: number,
  pointerY: number,
  priceToPx: (price: number) => number,
  thresholdPx = SNAP_THRESHOLD_PX,
): DrawingPoint {
  if (candles.length === 0 || !Number.isFinite(fractionalIndex)) return point;
  const i = Math.max(0, Math.min(candles.length - 1, Math.round(fractionalIndex)));
  const c = candles[i];
  let best: number | null = null;
  let bestDist = Infinity;
  for (const price of [c.open, c.high, c.low, c.close]) {
    const d = Math.abs(priceToPx(price) - pointerY);
    if (d < bestDist) { bestDist = d; best = price; }
  }
  return best !== null && bestDist <= thresholdPx ? { time: c.time, price: best } : point;
}
