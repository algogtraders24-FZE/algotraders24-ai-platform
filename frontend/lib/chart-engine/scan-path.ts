// lib/chart-engine/scan-path.ts
// The smooth "price wave" drawn during the Analyze scan: an exponential moving average of the visible closes,
// mapped to the same pixel positions the candles use (gapless index x-axis, same price scale).
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { priceToY } from "./coordinate-system";
import { indexRangeForViewport, indexToX } from "./index-scale";

export function computeScanPath(
  candles: readonly ChartCandle[],
  viewport: Viewport,
  dims: { width: number; height: number; priceAxisWidth: number; timeAxisHeight: number },
  span = 10,
): [number, number][] {
  const plotWidth = Math.max(0, dims.width - dims.priceAxisWidth);
  const plotHeight = Math.max(0, dims.height - dims.timeAxisHeight);
  if (candles.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];
  const range = indexRangeForViewport(candles as ChartCandle[], viewport);
  const k = 2 / (span + 1);
  let ema = candles[0].close;
  const pts: [number, number][] = [];
  for (let i = 0; i < candles.length; i++) {
    ema = i === 0 ? candles[0].close : candles[i].close * k + ema * (1 - k);
    const x = indexToX(i, range, plotWidth);
    if (x < -4 || x > plotWidth + 4) continue;
    const y = priceToY(ema, viewport, plotHeight);
    pts.push([x, Math.max(0, Math.min(plotHeight, y))]);
  }
  return pts;
}

/**
 * The layered curves drawn during the Analyze scan: a smooth price curve, an upper and a lower envelope (EMAs of the highs and lows) and a slower
 * trend curve. Each sweep of the scan adds the next one. All four are pure functions of the visible candles and share the candles' pixel mapping.
 */
export function computeScanCurves(
  candles: readonly ChartCandle[],
  viewport: Viewport,
  dims: { width: number; height: number; priceAxisWidth: number; timeAxisHeight: number },
): [number, number][][] {
  const plotWidth = Math.max(0, dims.width - dims.priceAxisWidth);
  const plotHeight = Math.max(0, dims.height - dims.timeAxisHeight);
  if (candles.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];
  const range = indexRangeForViewport(candles as ChartCandle[], viewport);
  const curve = (pick: (c: ChartCandle) => number, span: number): [number, number][] => {
    const k = 2 / (span + 1);
    let ema = pick(candles[0]);
    const pts: [number, number][] = [];
    for (let i = 0; i < candles.length; i++) {
      ema = i === 0 ? pick(candles[0]) : pick(candles[i]) * k + ema * (1 - k);
      const x = indexToX(i, range, plotWidth);
      if (x < -4 || x > plotWidth + 4) continue;
      pts.push([x, Math.max(0, Math.min(plotHeight, priceToY(ema, viewport, plotHeight)))]);
    }
    return pts;
  };
  return [curve((c) => c.close, 10), curve((c) => c.high, 18), curve((c) => c.low, 18), curve((c) => c.close, 40)];
}
