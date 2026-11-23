// lib/chart-engine/scan-path.ts
// The smooth "price wave" drawn during the Analyze scan: an exponential moving average of the visible closes,
// mapped to the same pixel positions the candles use (gapless index x-axis, same price scale).
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { priceToY } from "./coordinate-system";
import { indexRangeForViewport, indexToX } from "./index-scale";
import { emaSeries } from "@/lib/market-data/indicators";

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

/** The two lines drawn during the Analyze scan are the real EMA 20 and EMA 50 of the closes (the same series as the chart's EMA indicators). */
export const SCAN_CURVE_LABELS = ["EMA 20", "EMA 50"] as const;

export function computeScanCurves(
  candles: readonly ChartCandle[],
  viewport: Viewport,
  dims: { width: number; height: number; priceAxisWidth: number; timeAxisHeight: number },
): [number, number][][] {
  const plotWidth = Math.max(0, dims.width - dims.priceAxisWidth);
  const plotHeight = Math.max(0, dims.height - dims.timeAxisHeight);
  if (candles.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];
  const range = indexRangeForViewport(candles as ChartCandle[], viewport);
  const closes = candles.map((c) => c.close);
  const curve = (period: number): [number, number][] => {
    const tail = emaSeries(closes, period);
    if (!tail) return [];
    const first = candles.length - tail.length;
    const pts: [number, number][] = [];
    for (let i = first; i < candles.length; i++) {
      const x = indexToX(i, range, plotWidth);
      if (x < -4 || x > plotWidth + 4) continue;
      pts.push([x, Math.max(0, Math.min(plotHeight, priceToY(tail[i - first], viewport, plotHeight)))]);
    }
    return pts;
  };
  return [curve(20), curve(50)];
}
