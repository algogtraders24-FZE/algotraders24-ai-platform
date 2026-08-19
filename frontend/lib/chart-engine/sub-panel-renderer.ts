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
//
// Gapless x-axis (this session) - every horizontal position here now goes
// through index-scale.ts's index-domain functions, not coordinate-
// system.ts's time-domain timeToX, matching renderer.ts's own candle
// positioning (see that file's header comment). A line/bar's real `time`
// is looked up to its fractional candle-index once per point - correct
// AND cheap, since every indicator/volume value is computed 1:1 from this
// same candles array, so the lookup nearly always resolves to an exact
// integer index, never a costly or approximate interpolation.
import type { ChartCandle } from "@/types/chart-data";
import type { IndicatorSeries } from "./indicators/types";
import { priceToY } from "./coordinate-system";
import { canvasMonoFont } from "./canvas-typography";
import { formatCompactVolume } from "@/lib/financial-format";
import type { ChartColors } from "./canvas-colors";
import type { PanelRow } from "./panel-layout";
import type { Viewport } from "./types";
import { fractionalIndexForTime, indexToX, type IndexRange } from "./index-scale";

const AXIS_FONT_SIZE = 10;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

function panelViewport(viewport: Viewport, minValue: number, maxValue: number): Viewport {
  return { minTime: viewport.minTime, maxTime: viewport.maxTime, minPrice: minValue, maxPrice: maxValue };
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  points: { time: number; value: number | undefined }[],
  candles: ChartCandle[],
  indexRange: IndexRange,
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
    const x = indexToX(fractionalIndexForTime(candles, point.time), indexRange, plotWidth);
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
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  priceRow: PanelRow,
): void {
  for (const series of overlays) {
    if (series.panel !== "price") continue;
    for (const line of series.lines) {
      drawLine(ctx, line.points, candles, indexRange, viewport, plotWidth, priceRow, line.color);
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

// Sprint D2.7.5, Phase 4 - the honest state Phase 4 explicitly asks for: a
// centered notice inside an otherwise-empty sub-panel, drawn only when the
// panel is genuinely empty because the SOURCE data lacks the field (never
// because the panel legitimately has nothing to show for other reasons,
// e.g. an indicator whose warm-up period hasn't been reached yet - that
// case already renders as an honest gap in the line itself, no notice
// needed). Never a fabricated bar/line - just a real, truthful label.
function drawEmptyPanelNotice(ctx: CanvasRenderingContext2D, row: PanelRow, plotWidth: number, colors: ChartColors, text: string): void {
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, plotWidth / 2, row.top + row.height / 2);
}

export function drawVolumePanel(
  ctx: CanvasRenderingContext2D,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "Volume");
  const from = Math.max(0, Math.floor(indexRange.minIndex));
  const to = Math.min(candles.length - 1, Math.ceil(indexRange.maxIndex));
  const visible: { index: number; candle: ChartCandle }[] = [];
  for (let i = from; i <= to; i++) {
    if (candles[i]?.volume !== undefined) visible.push({ index: i, candle: candles[i] });
  }
  if (visible.length === 0) {
    // Distinguish "this instrument's provider doesn't report volume" (a
    // real, honest limitation worth surfacing) from "there simply are no
    // candles loaded yet" (already covered by NativeChart's own
    // loading/empty states - repeating a notice here would be redundant).
    if (candles.length > 0) drawEmptyPanelNotice(ctx, row, plotWidth, colors, "No volume data for this instrument");
    return;
  }
  const maxVolume = Math.max(...visible.map((v) => v.candle.volume as number));
  if (maxVolume <= 0) return;
  const panelVp = panelViewport(viewport, 0, maxVolume);
  const pixelsPerIndex = plotWidth / Math.max(1e-6, indexRange.maxIndex - indexRange.minIndex);
  const barWidth = Math.max(1, pixelsPerIndex * 0.7);

  for (const { index, candle } of visible) {
    const x = indexToX(index, indexRange, plotWidth);
    const y = row.top + priceToY(candle.volume as number, panelVp, row.height);
    const bottom = row.top + row.height;
    // MT5-style theme (this session): a single uniform volume color,
    // matching the user's live terminal reference (plain green bars, not
    // a bullish/bearish two-tone). Only set for the "mt5" palette - the
    // "at24" theme's colors.volume is undefined, so this falls through to
    // the original, unchanged two-tone logic below.
    if (colors.volume) {
      ctx.fillStyle = colors.volume;
    } else {
      const isUp = candle.close >= candle.open;
      ctx.fillStyle = isUp ? colors.bullish : colors.bearish;
    }
    ctx.fillRect(x - barWidth / 2, y, barWidth, bottom - y);
  }

  // Sprint D2.7.6, Phase 9 - a real value-axis reference the Volume panel
  // previously lacked entirely (bars with no numeric scale at all). The
  // real max volume of the visible window, formatted with the SAME
  // formatCompactVolume() every other volume figure on the platform uses -
  // never a second/ad hoc volume formatter.
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(formatCompactVolume(maxVolume), plotWidth - 4, row.top + 2);
}

export function drawRsiPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
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

  // Sprint D2.7.6, Phase 9 - real numeric labels for the overbought/oversold
  // reference lines above, previously drawn with no value at all (a trader
  // had to already know 70/30 was the convention). Real, standard RSI
  // levels - never an invented threshold.
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  for (const level of [RSI_OVERSOLD, RSI_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.textBaseline = level === RSI_OVERBOUGHT ? "bottom" : "top";
    ctx.fillText(String(level), plotWidth - 4, y);
  }

  if (!series) return;
  const line = series.lines[0];
  if (line) drawLine(ctx, line.points, candles, indexRange, panelVp, plotWidth, row, line.color);
}

export function drawMacdPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
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

  // Sprint D2.7.6, Phase 9 - a real zero reference line, previously implicit
  // only via the histogram bars' own baseline (invisible whenever the
  // histogram itself has no visible bars, e.g. only macd/signal lines are
  // in view). Matches RSI's own dashed-reference-line convention.
  const zeroLineY = row.top + priceToY(0, panelVp, row.height);
  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(0, zeroLineY);
  ctx.lineTo(plotWidth, zeroLineY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (histogram) {
    const pixelsPerIndex = plotWidth / Math.max(1e-6, indexRange.maxIndex - indexRange.minIndex);
    const barWidth = Math.max(1, pixelsPerIndex * 0.7);
    const zeroY = row.top + priceToY(0, panelVp, row.height);
    for (const point of histogram.points) {
      if (point.value === undefined) continue;
      const x = indexToX(fractionalIndexForTime(candles, point.time), indexRange, plotWidth);
      const y = row.top + priceToY(point.value, panelVp, row.height);
      ctx.fillStyle = point.value >= 0 ? colors.bullish : colors.bearish;
      const top = Math.min(y, zeroY);
      const height = Math.max(1, Math.abs(y - zeroY));
      ctx.fillRect(x - barWidth / 2, top, barWidth, height);
    }
  }
  if (macdLine) drawLine(ctx, macdLine.points, candles, indexRange, panelVp, plotWidth, row, macdLine.color);
  if (signalLine) drawLine(ctx, signalLine.points, candles, indexRange, panelVp, plotWidth, row, signalLine.color);
}
