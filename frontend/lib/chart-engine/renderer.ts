// lib/chart-engine/renderer.ts
// Sprint D2.7.2, Phases 5/6/8/9/10 - the Canvas 2D draw layer. A pure
// function of its inputs (ctx is mutated as a drawing surface, but every
// pixel drawn is fully determined by candles/viewport/dims/colors - no
// hidden state, no accumulation across calls) so the same inputs always
// produce the same picture. Kept separate from NativeChart.tsx (the React
// orchestrator) per the sprint's "not one monolithic React component"
// instruction - this file has zero React/DOM-event knowledge, only
// CanvasRenderingContext2D drawing calls.
//
// Sprint D2.7.3, Phase 7/8 - now panel-aware: the price panel (candles +
// grid + price axis + indicator overlays) occupies only its own row within
// the total plot height (computePanelLayout, panel-layout.ts); any active
// Volume/RSI/MACD sub-panels are drawn below it in their own rows by
// sub-panel-renderer.ts. All panels share the SAME horizontal time axis
// (drawn once, at the bottom) since they all share one Viewport's time
// range - only the price panel has its own vertical price scale, per
// panel.
import type { ChartCandle } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";
import { formatTimestamp } from "@/lib/financial-format";
import type { ChartColors } from "./canvas-colors";
import { canvasMonoFont } from "./canvas-typography";
import { classifyCandle } from "./candle-classifier";
import { priceToY, timeToX } from "./coordinate-system";
import { computePriceTicks, type PriceAxisTick } from "./price-axis";
import { computeTimeTicks, type TimeAxisTick } from "./time-axis";
import type { ChartDimensions, CrosshairState, Viewport } from "./types";
import { candleStepMs } from "./viewport";
import { computePanelLayout, type PanelRow } from "./panel-layout";
import { drawOverlays, drawVolumePanel, drawRsiPanel, drawMacdPanel } from "./sub-panel-renderer";
import type { IndicatorSeries, ChartPanelId } from "./indicators/types";

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  dims: ChartDimensions;
  /** Full series (oldest-first) - the renderer itself decides what's visible from the viewport, so callers never need to pre-slice. */
  candles: ChartCandle[];
  viewport: Viewport;
  timeframe: SignalTimeframe;
  crosshair?: CrosshairState | null;
  colors: ChartColors;
  /** Sub-panels to render below the price panel, e.g. ["volume", "rsi"] - "price" is implicit and always included. Empty array (default) reproduces D2.7.2's original single-panel layout exactly. */
  activePanels?: ChartPanelId[];
  /** Every currently-active indicator's already-computed series (overlays AND sub-panel indicators together) - the renderer only reads `.panel` to decide where each draws. */
  indicatorSeries?: IndicatorSeries[];
}

const AXIS_FONT_SIZE = 11;
const BODY_WIDTH_RATIO = 0.7;
const MIN_BODY_WIDTH_PX = 1;

export function renderChart(params: RenderParams): void {
  const { ctx, dims, candles, viewport, timeframe, crosshair, colors, activePanels = [], indicatorSeries = [] } = params;
  const plotWidth = Math.max(0, dims.width - dims.priceAxisWidth);
  const plotHeight = Math.max(0, dims.height - dims.timeAxisHeight);

  ctx.clearRect(0, 0, dims.width, dims.height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, dims.width, dims.height);

  if (plotWidth <= 0 || plotHeight <= 0) return;

  const layout = computePanelLayout(activePanels, plotHeight);
  const priceRow = layout.find((r) => r.id === "price") ?? { id: "price" as const, top: 0, height: plotHeight };

  const priceTicks = computePriceTicks(viewport);
  drawPriceGrid(ctx, priceTicks, viewport, plotWidth, priceRow, colors);
  drawCandles(ctx, candles, viewport, plotWidth, priceRow, colors);
  drawOverlays(ctx, indicatorSeries, viewport, plotWidth, priceRow);
  drawPriceAxis(ctx, priceTicks, viewport, plotWidth, priceRow, colors);

  for (const row of layout) {
    if (row.id === "price") continue;
    const series = indicatorSeries.find((s) => s.panel === row.id);
    if (row.id === "volume") drawVolumePanel(ctx, candles, viewport, plotWidth, row, colors);
    else if (row.id === "rsi") drawRsiPanel(ctx, series, viewport, plotWidth, row, colors);
    else if (row.id === "macd") drawMacdPanel(ctx, series, viewport, plotWidth, row, colors);
  }

  const timeTicks = computeTimeTicks(candles, viewport, timeframe);
  drawTimeAxis(ctx, timeTicks, viewport, plotWidth, plotHeight, colors);

  if (crosshair && crosshair.index >= 0 && crosshair.index < candles.length) {
    drawCrosshair(ctx, crosshair, candles[crosshair.index], viewport, plotWidth, plotHeight, colors);
  }
}

function drawPriceGrid(ctx: CanvasRenderingContext2D, ticks: PriceAxisTick[], viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (const tick of ticks) {
    const y = Math.round(row.top + priceToY(tick.price, viewport, row.height)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
  }
}

function drawCandles(ctx: CanvasRenderingContext2D, candles: ChartCandle[], viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  if (candles.length === 0) return;
  const step = candleStepMs(candles);
  const pixelsPerMs = plotWidth / Math.max(1, viewport.maxTime - viewport.minTime);
  const bodyWidth = Math.max(MIN_BODY_WIDTH_PX, step * pixelsPerMs * BODY_WIDTH_RATIO);

  for (const candle of candles) {
    if (candle.time < viewport.minTime - step || candle.time > viewport.maxTime + step) continue;
    const x = timeToX(candle.time, viewport, plotWidth);
    const trend = classifyCandle(candle);
    const color = trend === "bearish" ? colors.bearish : trend === "bullish" ? colors.bullish : colors.textTertiary;

    const highY = row.top + priceToY(candle.high, viewport, row.height);
    const lowY = row.top + priceToY(candle.low, viewport, row.height);
    const openY = row.top + priceToY(candle.open, viewport, row.height);
    const closeY = row.top + priceToY(candle.close, viewport, row.height);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x), highY);
    ctx.lineTo(Math.round(x), lowY);
    ctx.stroke();

    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    ctx.fillStyle = color;
    ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  }
}

function drawPriceAxis(ctx: CanvasRenderingContext2D, ticks: PriceAxisTick[], viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const tick of ticks) {
    const y = row.top + priceToY(tick.price, viewport, row.height);
    ctx.fillText(tick.price.toFixed(tick.decimals), plotWidth + 6, y);
  }
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  ticks: TimeAxisTick[],
  viewport: Viewport,
  plotWidth: number,
  plotHeight: number,
  colors: ChartColors,
): void {
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of ticks) {
    const x = timeToX(tick.time, viewport, plotWidth);
    const label = formatTimestamp(tick.time, tick.granularity);
    ctx.fillText(label, x, plotHeight + 6);
  }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  crosshair: CrosshairState,
  candle: ChartCandle,
  viewport: Viewport,
  plotWidth: number,
  plotHeight: number,
  colors: ChartColors,
): void {
  const x = timeToX(candle.time, viewport, plotWidth);
  const y = Math.max(0, Math.min(plotHeight, crosshair.y));

  ctx.strokeStyle = colors.textTertiary;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, plotHeight);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.gold;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(formatTimestamp(candle.time, "datetime"), x, plotHeight + 6);
}
