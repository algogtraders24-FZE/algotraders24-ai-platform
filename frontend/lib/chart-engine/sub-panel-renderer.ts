// lib/chart-engine/sub-panel-renderer.ts
// Sprint D2.7.3, Phase 7/8 - draws indicator overlays (on the price panel)
// and indicator sub-panels (Volume/RSI/MACD, each in their own row). This
// file is the "Renderer" step of the mandatory Calculation Layer ->
// Indicator Data -> Chart Coordinate System -> Renderer pipeline: it knows
// nothing about how an IndicatorSeries' values were computed, only how to
// turn its already-computed points into pixels via the SAME coordinate-
// system.ts functions renderer.ts already uses (a per-panel Viewport with
// that panel's own price/value range, passed the panel row's own height as
// `plotHeight`, with the panel row's `top` added to every resulting y).
import type { ChartCandle } from "@/types/chart-data";
import type { IndicatorSeries } from "./indicators/types";
import { priceToY, timeToX } from "./coordinate-system";
import { candleStepMs } from "./viewport";
import { canvasMonoFont } from "./canvas-typography";
import type { ChartColors } from "./canvas-colors";
import type { PanelRow } from "./panel-layout";
import type { Viewport } from "./types";

const AXIS_FONT_SIZE = 10;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

function panelViewport(viewport: Viewport, minValue: number, maxValue: number): Viewport {
  return { minTime: viewport.minTime, maxTime: viewport.maxTime, minPrice: minValue, maxPrice: maxValue };
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  points: { time: number; value: number | undefined }[],
  viewport: Viewport,
  panelVp: Viewport,
  plotWidth: number,
  row: PanelRow,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    if (point.value === undefined) {
      started = false;
      continue;
    }
    const x = timeToX(point.time, viewport, plotWidth);
    const y = row.top + priceToY(point.value, panelVp, row.height);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

/** EMA/SMA/Bollinger overlays, drawn directly on the price panel using its OWN price viewport - never a separate value scale from the candles they annotate. */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: IndicatorSeries[],
  viewport: Viewport,
  plotWidth: number,
  priceRow: PanelRow,
): void {
  for (const series of overlays) {
    if (series.panel !== "price") continue;
    for (const line of series.lines) {
      drawLine(ctx, line.points, viewport, viewport, plotWidth, priceRow, line.color);
    }
  }
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, row: PanelRow, plotWidth: number, colors: ChartColors, label: string): void {
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, row.top);
  ctx.lineTo(plotWidth, row.top);
  ctx.stroke();

  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, 4, row.top + 2);
}

export function drawVolumePanel(
  ctx: CanvasRenderingContext2D,
  candles: ChartCandle[],
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "Volume");
  const visible = candles.filter((c) => c.time >= viewport.minTime && c.time <= viewport.maxTime && c.volume !== undefined);
  if (visible.length === 0) return;
  const maxVolume = Math.max(...visible.map((c) => c.volume as number));
  if (maxVolume <= 0) return;
  const panelVp = panelViewport(viewport, 0, maxVolume);
  const step = candleStepMs(candles);
  const pixelsPerMs = plotWidth / Math.max(1, viewport.maxTime - viewport.minTime);
  const barWidth = Math.max(1, step * pixelsPerMs * 0.7);

  for (const c of visible) {
    const x = timeToX(c.time, viewport, plotWidth);
    const y = row.top + priceToY(c.volume as number, panelVp, row.height);
    const bottom = row.top + row.height;
    const isUp = c.close >= c.open;
    ctx.fillStyle = isUp ? colors.bullish : colors.bearish;
    ctx.fillRect(x - barWidth / 2, y, barWidth, bottom - y);
  }
}

export function drawRsiPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "RSI");
  const panelVp = panelViewport(viewport, 0, 100);

  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  for (const level of [RSI_OVERSOLD, RSI_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (!series) return;
  const line = series.lines[0];
  if (line) drawLine(ctx, line.points, viewport, panelVp, plotWidth, row, line.color);
}

export function drawMacdPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "MACD");
  if (!series) return;
  const [macdLine, signalLine, histogram] = series.lines;

  const visibleValues = [macdLine, signalLine, histogram]
    .flatMap((l) => l?.points ?? [])
    .filter((p) => p.time >= viewport.minTime && p.time <= viewport.maxTime && p.value !== undefined)
    .map((p) => p.value as number);
  if (visibleValues.length === 0) return;
  const maxAbs = Math.max(1e-9, ...visibleValues.map((v) => Math.abs(v)));
  const panelVp = panelViewport(viewport, -maxAbs, maxAbs);

  if (histogram) {
    const pixelsPerMs = plotWidth / Math.max(1, viewport.maxTime - viewport.minTime);
    const times = histogram.points.map((p) => p.time);
    const spacing = times.length > 1 ? times[1] - times[0] : 0;
    const barWidth = Math.max(1, spacing * pixelsPerMs * 0.7);
    const zeroY = row.top + priceToY(0, panelVp, row.height);
    for (const point of histogram.points) {
      if (point.value === undefined) continue;
      const x = timeToX(point.time, viewport, plotWidth);
      const y = row.top + priceToY(point.value, panelVp, row.height);
      ctx.fillStyle = point.value >= 0 ? colors.bullish : colors.bearish;
      const top = Math.min(y, zeroY);
      const height = Math.max(1, Math.abs(y - zeroY));
      ctx.fillRect(x - barWidth / 2, top, barWidth, height);
    }
  }
  if (macdLine) drawLine(ctx, macdLine.points, viewport, panelVp, plotWidth, row, macdLine.color);
  if (signalLine) drawLine(ctx, signalLine.points, viewport, panelVp, plotWidth, row, signalLine.color);
}
