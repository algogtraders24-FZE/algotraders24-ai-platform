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
import { resolveIndicatorColor } from "./canvas-colors";
import type { PanelRow } from "./panel-layout";
import type { Viewport } from "./types";
import { fractionalIndexForTime, indexToX, type IndexRange } from "./index-scale";

const AXIS_FONT_SIZE = 10;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
// Stochastic's own real, standard overbought/oversold convention - 80/20,
// deliberately DIFFERENT from RSI's 70/30 (a common beginner mix-up this
// codebase's own constants keep honestly separate rather than reusing
// RSI's thresholds for a different oscillator).
const STOCHASTIC_OVERBOUGHT = 80;
const STOCHASTIC_OVERSOLD = 20;
// CCI's own real, standard reference lines - +-100 (not a bounded
// oscillator like RSI/Stochastic, so these are reference thresholds on a
// dynamic scale, never a fixed axis range).
const CCI_REFERENCE_LEVEL = 100;
// Williams %R's own real, standard overbought/oversold convention on its
// [-100,0] range - -20/-80, the mirror image of Stochastic's 80/20.
const WILLIAMS_R_OVERBOUGHT = -20;
const WILLIAMS_R_OVERSOLD = -80;

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
  ctx.strokeStyle = resolveIndicatorColor(color);
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

const SAR_DOT_SIZE_PX = 3;

/** Parabolic SAR's own real MT5 visual convention (this session) - discrete dots at each candle's stop-and-reverse level, never a connected line (a connected line would visually imply a continuous value between candles, which isn't what a stop-and-reverse LEVEL means). Uses fillRect (never ctx.arc - a new canvas primitive this codebase's test-fake CanvasRenderingContext2D mocks don't implement, the same constraint drawCandles'/drawing-renderer.ts's own comments document for strokeRect). */
function drawDots(
  ctx: CanvasRenderingContext2D,
  points: { time: number; value: number | undefined }[],
  candles: ChartCandle[],
  indexRange: IndexRange,
  panelVp: Viewport,
  plotWidth: number,
  row: PanelRow,
  color: string,
): void {
  ctx.fillStyle = resolveIndicatorColor(color);
  for (const point of points) {
    if (point.value === undefined) continue;
    const x = indexToX(fractionalIndexForTime(candles, point.time), indexRange, plotWidth);
    const y = row.top + priceToY(point.value, panelVp, row.height);
    ctx.fillRect(x - SAR_DOT_SIZE_PX / 2, y - SAR_DOT_SIZE_PX / 2, SAR_DOT_SIZE_PX, SAR_DOT_SIZE_PX);
  }
}

/** EMA/SMA/Bollinger/Parabolic SAR overlays, drawn directly on the price panel using its OWN price viewport - never a separate value scale from the candles they annotate. Branches on each line's own `style` (never `config.id`) - the same "renderer doesn't know indicator-specific semantics" discipline Bollinger's band-edge style already established. */
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
      if (line.style === "dots") drawDots(ctx, line.points, candles, indexRange, viewport, plotWidth, priceRow, line.color);
      else drawLine(ctx, line.points, candles, indexRange, viewport, plotWidth, priceRow, line.color);
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

/** ATR (Phase 2) - a dynamic 0..max scale, the same "real max of the visible window" convention drawVolumePanel already uses, since ATR is an unbounded, instrument-specific price magnitude (unlike RSI/Stochastic's fixed 0-100 range) - there is no honest fixed scale to draw it against. */
export function drawAtrPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "ATR");
  if (!series) return;
  const line = series.lines[0];
  if (!line) return;

  const visibleValues = line.points
    .filter((p) => p.time >= viewport.minTime && p.time <= viewport.maxTime && p.value !== undefined)
    .map((p) => p.value as number);
  if (visibleValues.length === 0) return;
  const maxValue = Math.max(...visibleValues);
  if (maxValue <= 0) return;
  const panelVp = panelViewport(viewport, 0, maxValue);

  drawLine(ctx, line.points, candles, indexRange, panelVp, plotWidth, row, line.color);

  // The real max ATR value in the visible window - the same "a real
  // numeric scale reference, never a bare unlabeled line" discipline
  // drawVolumePanel/drawRsiPanel already established.
  const decimals = maxValue < 10 ? 4 : 2;
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(maxValue.toFixed(decimals), plotWidth - 4, row.top + 2);
}

/** Stochastic Oscillator (Phase 2) - a fixed 0-100 scale like RSI, but with the real, DIFFERENT 80/20 overbought/oversold convention (never RSI's 70/30) and two lines: %K (the smoothed "Slow Stochastic" main line - see indicators.ts's stochasticSeries() for why it's already smoothed by MT5's real default Slowing period) and %D (its own further-smoothed signal line). */
export function drawStochasticPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "Stochastic");
  const panelVp = panelViewport(viewport, 0, 100);

  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  for (const level of [STOCHASTIC_OVERSOLD, STOCHASTIC_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  for (const level of [STOCHASTIC_OVERSOLD, STOCHASTIC_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.textBaseline = level === STOCHASTIC_OVERBOUGHT ? "bottom" : "top";
    ctx.fillText(String(level), plotWidth - 4, y);
  }

  if (!series) return;
  const [kLine, dLine] = series.lines;
  if (kLine) drawLine(ctx, kLine.points, candles, indexRange, panelVp, plotWidth, row, kLine.color);
  if (dLine) drawLine(ctx, dLine.points, candles, indexRange, panelVp, plotWidth, row, dLine.color);
}

/** ADX (Phase 2 continued) - a fixed 0-100 scale (all three lines are genuinely bounded in that range by construction - see indicators.ts's adxSeries()), with the real ADX (trend strength) plus +DI/-DI (directional bias) lines. Deliberately no overbought/oversold reference lines - MT5's own real ADX indicator doesn't draw one by default (it's a trend-strength gauge, not a bounded oscillator with a genuine threshold convention like RSI/Stochastic), so this never fabricates a UI element that isn't actually there. */
export function drawAdxPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "ADX");
  if (!series) return;
  const panelVp = panelViewport(viewport, 0, 100);
  const [adxLine, plusDI, minusDI] = series.lines;
  if (plusDI) drawLine(ctx, plusDI.points, candles, indexRange, panelVp, plotWidth, row, plusDI.color);
  if (minusDI) drawLine(ctx, minusDI.points, candles, indexRange, panelVp, plotWidth, row, minusDI.color);
  if (adxLine) drawLine(ctx, adxLine.points, candles, indexRange, panelVp, plotWidth, row, adxLine.color);
}

/** CCI (Phase 2 continued) - a dynamic scale, but one that always includes CCI's own real +-100 reference levels even when the visible data's own range is narrower, so those reference lines stay meaningful (never silently squeezed out of view). Genuinely unbounded (a strong trend can push CCI well past +-100) - the scale expands to fit whichever is larger. */
export function drawCciPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "CCI");
  if (!series) return;
  const line = series.lines[0];
  if (!line) return;

  const visibleValues = line.points
    .filter((p) => p.time >= viewport.minTime && p.time <= viewport.maxTime && p.value !== undefined)
    .map((p) => p.value as number);
  const maxAbs = Math.max(CCI_REFERENCE_LEVEL, ...visibleValues.map((v) => Math.abs(v)));
  const panelVp = panelViewport(viewport, -maxAbs, maxAbs);

  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  for (const level of [-CCI_REFERENCE_LEVEL, CCI_REFERENCE_LEVEL]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  for (const level of [-CCI_REFERENCE_LEVEL, CCI_REFERENCE_LEVEL]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.textBaseline = level === CCI_REFERENCE_LEVEL ? "bottom" : "top";
    ctx.fillText(String(level), plotWidth - 4, y);
  }

  drawLine(ctx, line.points, candles, indexRange, panelVp, plotWidth, row, line.color);
}

/** Williams %R (Phase 2 continued) - a fixed [-100,0] scale (genuinely bounded by construction - see indicators.ts's williamsPercentRSeries()), with its own real -20/-80 overbought/oversold reference lines - the mirror image of Stochastic's 80/20, never reused/confused with it. */
export function drawWilliamsRPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "Williams %R");
  const panelVp = panelViewport(viewport, -100, 0);

  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  for (const level of [WILLIAMS_R_OVERSOLD, WILLIAMS_R_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "right";
  for (const level of [WILLIAMS_R_OVERSOLD, WILLIAMS_R_OVERBOUGHT]) {
    const y = row.top + priceToY(level, panelVp, row.height);
    ctx.textBaseline = level === WILLIAMS_R_OVERBOUGHT ? "bottom" : "top";
    ctx.fillText(String(level), plotWidth - 4, y);
  }

  if (!series) return;
  const line = series.lines[0];
  if (line) drawLine(ctx, line.points, candles, indexRange, panelVp, plotWidth, row, line.color);
}

/**
 * Bill Williams' Awesome Oscillator (Sprint D2.7.11) - a dynamic scale like
 * ATR/MACD (unbounded, instrument-specific magnitude), drawn as a
 * histogram. Deliberately colored by comparison to the PREVIOUS bar's own
 * value (green when rising, red when falling) - MT5's own real AO
 * convention (metatrader5.com), genuinely different from MACD's histogram
 * above which colors by sign (>=0 vs <0). Conflating the two would be a
 * real, incorrect claim about how this indicator's own color convention
 * works, not just a cosmetic choice.
 */
export function drawAwesomeOscillatorPanel(
  ctx: CanvasRenderingContext2D,
  series: IndicatorSeries | undefined,
  candles: ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
): void {
  drawPanelFrame(ctx, row, plotWidth, colors, "Awesome Oscillator");
  if (!series) return;
  const line = series.lines[0];
  if (!line) return;

  const visibleValues = line.points
    .filter((p) => p.time >= viewport.minTime && p.time <= viewport.maxTime && p.value !== undefined)
    .map((p) => p.value as number);
  if (visibleValues.length === 0) return;
  const maxAbs = Math.max(1e-9, ...visibleValues.map((v) => Math.abs(v)));
  const panelVp = panelViewport(viewport, -maxAbs, maxAbs);

  const zeroY = row.top + priceToY(0, panelVp, row.height);
  ctx.strokeStyle = colors.grid;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(plotWidth, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  const pixelsPerIndex = plotWidth / Math.max(1e-6, indexRange.maxIndex - indexRange.minIndex);
  const barWidth = Math.max(1, pixelsPerIndex * 0.7);
  let previousValue: number | undefined;
  for (const point of line.points) {
    if (point.value === undefined) {
      previousValue = undefined;
      continue;
    }
    const x = indexToX(fractionalIndexForTime(candles, point.time), indexRange, plotWidth);
    const y = row.top + priceToY(point.value, panelVp, row.height);
    const rising = previousValue === undefined ? true : point.value >= previousValue;
    ctx.fillStyle = rising ? colors.bullish : colors.bearish;
    const top = Math.min(y, zeroY);
    const height = Math.max(1, Math.abs(y - zeroY));
    ctx.fillRect(x - barWidth / 2, top, barWidth, height);
    previousValue = point.value;
  }
}
