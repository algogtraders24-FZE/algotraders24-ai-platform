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
import { priceToY, yToPrice } from "./coordinate-system";
import { computePriceTicks, targetPriceTickCountForHeight, type PriceAxisTick } from "./price-axis";
import { computeTimeTicks, computePeriodSeparators, targetTimeTickCountForWidth, type PeriodSeparator, type TimeAxisTick } from "./time-axis";
import type { ChartDimensions, ChartRenderType, CrosshairState, Viewport } from "./types";
import { computePanelLayout, type PanelRow } from "./panel-layout";
import { indexRangeForViewport, indexToX, type IndexRange } from "./index-scale";
import {
  drawOverlays,
  drawVolumePanel,
  drawRsiPanel,
  drawMacdPanel,
  drawAtrPanel,
  drawStochasticPanel,
  drawAdxPanel,
  drawCciPanel,
  drawWilliamsRPanel,
} from "./sub-panel-renderer";
import type { IndicatorSeries, ChartPanelId } from "./indicators/types";
import { drawDrawingObjects, drawDrawingPreview } from "./drawing/drawing-renderer";
import type { DrawingObject, DrawingPreview } from "./drawing/types";

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
  /** MT5-style in-chart label ("SYMBOL, TIMEFRAME: Display Name"), drawn top-left of the price panel - matches the user's live MT5 terminal reference. Optional: when omitted, nothing is drawn (never a placeholder/guessed label). */
  symbolLabel?: string;
  /** MT5 feature-parity Phase 1 - user-drawn trend lines/horizontal lines/rectangles, anchored in real time/price space. Defaults to empty - zero behavior/regression for any existing caller that doesn't pass this. */
  drawingObjects?: DrawingObject[];
  selectedDrawingObjectId?: string | null;
  /** The live "rubber band" preview between a 2-click tool's first and second click - never persisted, drawn only while a placement is in progress. */
  drawingPreview?: DrawingPreview | null;
  /** This session - the live bid/ask (useLiveQuote.ts), preferred over the last candle's close for the current-price marker when present. Omitted/null means "no live quote yet" - the marker falls back to the candle close exactly as it always has, never a fabricated bid/ask. */
  liveQuote?: { bid: number; ask: number } | null;
  /** Sprint D2.7.11 Phase 5 - MT5's Bar chart / Candlesticks / Line chart price-panel style. Defaults to "candlestick" - every existing caller that never passes this renders byte-for-byte as before this phase. */
  chartType?: ChartRenderType;
  /** Sprint D2.7.11 Phase 5b - MT5's "Show grid" toggle (Properties dialog, Show tab). Defaults to true, preserving this renderer's own pre-Phase-5b behavior (the grid has always been drawn unconditionally). */
  showGrid?: boolean;
  /** Sprint D2.7.11 Phase 5b - MT5's "Show period separators" toggle. Defaults to false, matching real MT5's own default (verified against the user's live Properties dialog screenshot) - a new feature, so there is no prior "always on" behavior to preserve here. */
  showPeriodSeparators?: boolean;
}

const AXIS_FONT_SIZE = 11;
const BODY_WIDTH_RATIO = 0.7;
const MIN_BODY_WIDTH_PX = 1;
// Sprint D2.7.6, Phase 4 - a real, previously-missing zoom-level cap.
// Without it, zooming to the MIN_VISIBLE_CANDLES floor (viewport.ts) could
// stretch a candle body past 100px - a comically oversized, unprofessional
// block rather than a readable candlestick. 24px matches the visual weight
// of every mainstream charting terminal's own maximum candle width.
const MAX_BODY_WIDTH_PX = 24;
const CROSSHAIR_PRICE_LABEL_WIDTH = 58;
const CROSSHAIR_PRICE_LABEL_HEIGHT = 14;

export function renderChart(params: RenderParams): void {
  const {
    ctx,
    dims,
    candles,
    viewport,
    timeframe,
    crosshair,
    colors,
    activePanels = [],
    indicatorSeries = [],
    symbolLabel,
    drawingObjects = [],
    selectedDrawingObjectId = null,
    drawingPreview = null,
    liveQuote = null,
    chartType = "candlestick",
    showGrid = true,
    showPeriodSeparators = false,
  } = params;
  const plotWidth = Math.max(0, dims.width - dims.priceAxisWidth);
  const plotHeight = Math.max(0, dims.height - dims.timeAxisHeight);

  ctx.clearRect(0, 0, dims.width, dims.height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, dims.width, dims.height);

  if (plotWidth <= 0 || plotHeight <= 0) return;

  const layout = computePanelLayout(activePanels, plotHeight);
  const priceRow = layout.find((r) => r.id === "price") ?? { id: "price" as const, top: 0, height: plotHeight };

  // Gapless x-axis (this session) - every candle/tick/drawn-object x
  // position below goes through this ONE index range, computed once per
  // render, never per-candle. See index-scale.ts's header comment for why:
  // a real market's weekend/missing-bar time gaps must never consume
  // proportional pixel width the way a naive time-linear x-axis would.
  const indexRange = indexRangeForViewport(candles, viewport);

  // Sprint D2.7.6, Phase 5/6 - tick density now derives from the panel's
  // real pixel space instead of a fixed constant, so labels never crowd on
  // a short/narrow viewport and a wide desktop panel isn't under-labeled.
  // Both helpers fall back to the original fixed counts when given a
  // non-finite/zero dimension - never a behavior change for a degenerate size.
  const priceTicks = computePriceTicks(viewport, targetPriceTickCountForHeight(priceRow.height));
  const timeTicks = computeTimeTicks(candles, viewport, timeframe, targetTimeTickCountForWidth(plotWidth));

  // Sprint D2.7.6, Phase 4 - vertical time-grid lines, drawn once behind
  // every panel (never per-panel) since every panel shares the SAME time
  // axis - keeps candles/bars visually aligned to the same time positions
  // across the price panel and any active sub-panels. Horizontal price
  // grid remains scoped to the price panel's own row, unchanged since D2.7.2.
  if (showGrid) {
    drawPriceGrid(ctx, priceTicks, viewport, plotWidth, priceRow, colors);
    drawTimeGrid(ctx, timeTicks, indexRange, plotWidth, plotHeight, colors);
  }
  if (showPeriodSeparators) {
    const separators = computePeriodSeparators(candles, timeframe);
    drawPeriodSeparators(ctx, separators, indexRange, plotWidth, plotHeight, colors);
  }

  if (chartType === "bar") drawBars(ctx, candles, indexRange, viewport, plotWidth, priceRow, colors);
  else if (chartType === "line") drawLine(ctx, candles, indexRange, viewport, plotWidth, priceRow, colors);
  else drawCandles(ctx, candles, indexRange, viewport, plotWidth, priceRow, colors);
  drawOverlays(ctx, indicatorSeries, candles, indexRange, viewport, plotWidth, priceRow);
  drawPriceAxis(ctx, priceTicks, viewport, plotWidth, priceRow, colors);
  drawLatestPriceMarker(ctx, candles, viewport, plotWidth, priceRow, colors, priceTicks, liveQuote);
  if (symbolLabel) drawSymbolLabel(ctx, symbolLabel, priceRow, colors);
  if (drawingObjects.length > 0) drawDrawingObjects(ctx, drawingObjects, candles, indexRange, viewport, plotWidth, priceRow, selectedDrawingObjectId);
  if (drawingPreview) drawDrawingPreview(ctx, drawingPreview, candles, indexRange, viewport, colors.accent, plotWidth, priceRow);

  for (const row of layout) {
    if (row.id === "price") continue;
    const series = indicatorSeries.find((s) => s.panel === row.id);
    if (row.id === "volume") drawVolumePanel(ctx, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "rsi") drawRsiPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "macd") drawMacdPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "atr") drawAtrPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "stochastic") drawStochasticPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "adx") drawAdxPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "cci") drawCciPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
    else if (row.id === "williams-r") drawWilliamsRPanel(ctx, series, candles, indexRange, viewport, plotWidth, row, colors);
  }

  drawTimeAxis(ctx, timeTicks, indexRange, plotWidth, plotHeight, colors);

  if (crosshair && crosshair.index >= 0 && crosshair.index < candles.length) {
    drawCrosshair(ctx, crosshair, candles[crosshair.index], indexRange, viewport, plotWidth, plotHeight, colors, priceRow, priceTicks);
  }
}

// Sprint D2.7.6, Phase 4 - the vertical counterpart to drawPriceGrid,
// previously entirely absent (only horizontal price gridlines existed).
// Uses the SAME crisp-1px-line convention (integer-round + 0.5 offset) as
// every other grid/axis line in this renderer.
function drawTimeGrid(ctx: CanvasRenderingContext2D, ticks: TimeAxisTick[], indexRange: IndexRange, plotWidth: number, plotHeight: number, colors: ChartColors): void {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (const tick of ticks) {
    const x = Math.round(indexToX(tick.index, indexRange, plotWidth)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotHeight);
    ctx.stroke();
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

// Sprint D2.7.11 Phase 5b - MT5's "Show period separators" line: a dashed
// vertical line at each new trading day, visually distinct from the plain
// solid time grid (drawTimeGrid above) so a day boundary reads as a real
// marker rather than just another grid line. Drawn across the FULL plot
// height (like drawTimeGrid), not scoped to the price row, since every
// panel shares the same time axis.
function drawPeriodSeparators(ctx: CanvasRenderingContext2D, separators: PeriodSeparator[], indexRange: IndexRange, plotWidth: number, plotHeight: number, colors: ChartColors): void {
  if (separators.length === 0) return;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  for (const sep of separators) {
    const x = Math.round(indexToX(sep.index, indexRange, plotWidth)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotHeight);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawCandles(ctx: CanvasRenderingContext2D, candles: ChartCandle[], indexRange: IndexRange, viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  if (candles.length === 0) return;
  // Gapless x-axis (this session) - one candle is always exactly one
  // index unit wide, so the pixels-per-candle ratio is simply the plot's
  // width divided by the visible index span. No candleStepMs/real-time
  // math needed here anymore - that was only ever a proxy for "how much
  // of one candle-width is visible", which the index span already IS,
  // directly and exactly, gaps or not.
  const pixelsPerIndex = plotWidth / Math.max(1e-6, indexRange.maxIndex - indexRange.minIndex);
  const bodyWidth = Math.min(MAX_BODY_WIDTH_PX, Math.max(MIN_BODY_WIDTH_PX, pixelsPerIndex * BODY_WIDTH_RATIO));

  // One index unit of padding on each side (the exact index-domain analog
  // of the old `candle.time < viewport.minTime - step` padding) so a
  // candle's wick/body doesn't visibly clip right at the panel edge.
  const from = Math.max(0, Math.floor(indexRange.minIndex) - 1);
  const to = Math.min(candles.length - 1, Math.ceil(indexRange.maxIndex) + 1);

  for (let i = from; i <= to; i++) {
    const candle = candles[i];
    const x = indexToX(i, indexRange, plotWidth);
    const trend = classifyCandle(candle);
    // MT5-style hollow-body rendering (this session, matching the user's
    // live terminal reference): a bearish body is filled in `bearish`
    // (black in the mt5 theme) with a distinct `bearishOutline` stroke -
    // without the outline a black body would be invisible against a black
    // background. For the original "at24" theme, bearishOutline resolves
    // to the same value as bearish (see canvas-colors.ts), so this draws
    // byte-for-byte identically to the prior solid-fill rendering there -
    // no regression for the default theme.
    const fillColor = trend === "bearish" ? colors.bearish : trend === "bullish" ? colors.bullish : colors.textTertiary;
    const outlineColor = trend === "bearish" ? colors.bearishOutline : fillColor;

    const highY = row.top + priceToY(candle.high, viewport, row.height);
    const lowY = row.top + priceToY(candle.low, viewport, row.height);
    const openY = row.top + priceToY(candle.open, viewport, row.height);
    const closeY = row.top + priceToY(candle.close, viewport, row.height);

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x), highY);
    ctx.lineTo(Math.round(x), lowY);
    ctx.stroke();

    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    const bodyLeft = x - bodyWidth / 2;
    ctx.fillStyle = fillColor;
    ctx.fillRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);

    // Hollow outline, drawn only when it actually differs from the fill
    // (the "at24" theme's outlineColor always equals fillColor - see
    // above - so this never runs there, an exact no-op/no-regression for
    // the original theme). Uses moveTo/lineTo/stroke rather than
    // strokeRect() so this reuses the exact same CanvasRenderingContext2D
    // methods the wick line above already relies on - never a new drawing
    // primitive this file didn't already depend on.
    if (outlineColor !== fillColor) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bodyLeft, bodyTop);
      ctx.lineTo(bodyLeft + bodyWidth, bodyTop);
      ctx.lineTo(bodyLeft + bodyWidth, bodyTop + bodyHeight);
      ctx.lineTo(bodyLeft, bodyTop + bodyHeight);
      ctx.lineTo(bodyLeft, bodyTop);
      ctx.stroke();
    }
  }
}

// Sprint D2.7.11 Phase 5 - MT5's "Bar chart" style: a plain OHLC bar (one
// vertical high-low line, a short left tick at open, a short right tick at
// close - never a filled body). Shares the exact same index-scale x
// positioning and MAX_BODY_WIDTH_PX-derived tick length as drawCandles, so
// switching chart type never shifts a candle/bar's horizontal position.
function drawBars(ctx: CanvasRenderingContext2D, candles: ChartCandle[], indexRange: IndexRange, viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  if (candles.length === 0) return;
  const pixelsPerIndex = plotWidth / Math.max(1e-6, indexRange.maxIndex - indexRange.minIndex);
  const tickWidth = Math.min(MAX_BODY_WIDTH_PX, Math.max(MIN_BODY_WIDTH_PX, pixelsPerIndex * BODY_WIDTH_RATIO)) / 2;

  const from = Math.max(0, Math.floor(indexRange.minIndex) - 1);
  const to = Math.min(candles.length - 1, Math.ceil(indexRange.maxIndex) + 1);

  for (let i = from; i <= to; i++) {
    const candle = candles[i];
    const x = Math.round(indexToX(i, indexRange, plotWidth));
    const trend = classifyCandle(candle);
    ctx.strokeStyle = trend === "bearish" ? colors.bearishOutline : trend === "bullish" ? colors.bullish : colors.textTertiary;
    ctx.lineWidth = 1;

    const highY = row.top + priceToY(candle.high, viewport, row.height);
    const lowY = row.top + priceToY(candle.low, viewport, row.height);
    const openY = row.top + priceToY(candle.open, viewport, row.height);
    const closeY = row.top + priceToY(candle.close, viewport, row.height);

    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.moveTo(x - tickWidth, openY);
    ctx.lineTo(x, openY);
    ctx.moveTo(x, closeY);
    ctx.lineTo(x + tickWidth, closeY);
    ctx.stroke();
  }
}

// Sprint D2.7.11 Phase 5 - MT5's "Line chart" style: a single polyline
// through each candle's close, in the same accent color as the current-price
// marker (drawLatestPriceMarker below) - both are "the price, over time",
// styled consistently rather than inventing a fourth chart color.
function drawLine(ctx: CanvasRenderingContext2D, candles: ChartCandle[], indexRange: IndexRange, viewport: Viewport, plotWidth: number, row: PanelRow, colors: ChartColors): void {
  if (candles.length === 0) return;
  const from = Math.max(0, Math.floor(indexRange.minIndex) - 1);
  const to = Math.min(candles.length - 1, Math.ceil(indexRange.maxIndex) + 1);
  if (to < from) return;

  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const x = indexToX(i, indexRange, plotWidth);
    const y = row.top + priceToY(candles[i].close, viewport, row.height);
    if (i === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// MT5-style in-chart label (this session), matching the top-left
// "SYMBOL, TIMEFRAME: Display Name" overlay in the user's own live MT5
// terminal reference. Deliberately just text, never a second data source -
// the caller (NativeChart.tsx) builds the string from the exact same
// symbol/timeframe/name the rest of the Workspace already uses.
function drawSymbolLabel(ctx: CanvasRenderingContext2D, label: string, priceRow: PanelRow, colors: ChartColors): void {
  ctx.font = canvasMonoFont(12);
  ctx.fillStyle = colors.textPrimary;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, 8, priceRow.top + 6);
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

// Sprint D2.7.4, Phase 9 - a professional-charting-platform staple, added
// only after correctness verification confirmed the underlying data (the
// last real candle's close) is trustworthy. A horizontal dashed line at
// the latest close, colored gold (AT24's brand accent, distinct from the
// grid/candle/indicator colors) with its real price value in the axis
// gutter - never a second price source, always the exact same candles[]
// the chart itself already renders.
//
// This session - when a live bid/ask quote is available (useLiveQuote.ts,
// the same /api/private/market-data/snapshot endpoint every other bid/ask
// display on this platform already calls), the line/label prefer the real
// live BID over the last candle's close - matching real MT5's own
// terminal, whose current-price line is always the live tradeable bid,
// not a possibly-seconds-stale candle close. The label also shows the
// real ask right next to it, so the live spread is visible at a glance -
// never a second/fabricated number when liveQuote is absent, the candle
// close alone is shown exactly as before this session.
function drawLatestPriceMarker(
  ctx: CanvasRenderingContext2D,
  candles: ChartCandle[],
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  colors: ChartColors,
  priceTicks: PriceAxisTick[],
  liveQuote?: { bid: number; ask: number } | null,
): void {
  const latest = candles[candles.length - 1];
  if (!latest) return;
  const price = liveQuote ? liveQuote.bid : latest.close;
  const y = row.top + priceToY(price, viewport, row.height);
  if (y < row.top - 1 || y > row.top + row.height + 1) return; // off-panel (zoomed/panned away) - never draw a marker outside its own panel

  // Sprint (this session) - uses `colors.accent` rather than `colors.gold`
  // directly: for the "at24" theme accent resolves to the exact same gold
  // value (see canvas-colors.ts), so this is byte-for-byte unchanged there;
  // the "mt5" theme's accent is a distinct teal so the current-price line
  // is never confused with a bullish/bearish candle color, matching the
  // user's own live terminal reference.
  ctx.strokeStyle = colors.accent;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const decimals = priceTicks[0]?.decimals ?? 2;
  const label = liveQuote ? `${price.toFixed(decimals)}/${liveQuote.ask.toFixed(decimals)}` : price.toFixed(decimals);
  // Box width fits the label's own length - never a fixed 58px assumption
  // that would clip a longer "bid/ask" string. Estimated by character
  // count (never ctx.measureText - this codebase's test-fake
  // CanvasRenderingContext2D mocks don't implement it, the same
  // constraint drawCandles' own comment documents for strokeRect).
  const AXIS_CHAR_WIDTH_PX = 6.6; // 11px monospace's own average glyph width
  const boxWidth = Math.max(58, label.length * AXIS_CHAR_WIDTH_PX + 8);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(plotWidth, y - 7, boxWidth, 14);
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.background;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, plotWidth + 4, y);
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  ticks: TimeAxisTick[],
  indexRange: IndexRange,
  plotWidth: number,
  plotHeight: number,
  colors: ChartColors,
): void {
  ctx.font = canvasMonoFont(AXIS_FONT_SIZE);
  ctx.fillStyle = colors.textTertiary;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of ticks) {
    const x = indexToX(tick.index, indexRange, plotWidth);
    const label = formatTimestamp(tick.time, tick.granularity);
    ctx.fillText(label, x, plotHeight + 6);
  }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  crosshair: CrosshairState,
  candle: ChartCandle,
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  plotHeight: number,
  colors: ChartColors,
  priceRow: PanelRow,
  priceTicks: PriceAxisTick[],
): void {
  const x = indexToX(crosshair.index, indexRange, plotWidth);
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
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(formatTimestamp(candle.time, "datetime"), x, plotHeight + 6);

  // Sprint D2.7.6, Phase 7 - the crosshair's real price-axis label, a
  // professional-charting staple this engine previously lacked entirely.
  // Deliberately scoped to ONLY the price panel's own row: a y-position
  // inside a sub-panel (Volume/RSI/MACD) has its own, DIFFERENT value scale
  // (e.g. 0-100 for RSI) - a number derived from the main price Viewport
  // there would be wrong/fabricated, so the label is simply omitted outside
  // the price row rather than guessed. Styled in `textTertiary` (steel),
  // never gold, so it's never confused with the latest-price marker.
  if (y >= priceRow.top && y <= priceRow.top + priceRow.height) {
    const price = yToPrice(y - priceRow.top, viewport, priceRow.height);
    const decimals = priceTicks[0]?.decimals ?? 2;
    ctx.fillStyle = colors.textTertiary;
    ctx.fillRect(plotWidth, y - CROSSHAIR_PRICE_LABEL_HEIGHT / 2, CROSSHAIR_PRICE_LABEL_WIDTH, CROSSHAIR_PRICE_LABEL_HEIGHT);
    ctx.fillStyle = colors.background;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(price.toFixed(decimals), plotWidth + 4, y);
  }
}
