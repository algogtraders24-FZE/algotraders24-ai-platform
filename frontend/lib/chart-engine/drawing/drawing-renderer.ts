// lib/chart-engine/drawing/drawing-renderer.ts
// Canvas draw layer for drawn objects - the same "pure function of its
// inputs" discipline renderer.ts itself follows (Sprint D2.7.2's own
// header comment): every pixel drawn is fully determined by the objects/
// viewport/colors passed in, no hidden state.
//
// Gapless x-axis (this session) - a drawn object's x position goes through
// the SAME index-scale.ts functions renderer.ts's own candle positioning
// uses, never coordinate-system.ts's time-domain timeToX. This isn't
// cosmetic: a trend line anchored across a real market gap (e.g. drawn
// from a Friday candle to a Monday candle) MUST land on those exact same
// gapless candle positions the price bars themselves render at, or the
// line would visibly detach from the candles it's meant to annotate.
//
// Deliberately never uses ctx.strokeRect/ctx.fillRect-with-inversion or
// any canvas method the existing renderer.ts doesn't already rely on -
// renderer.ts's own drawCandles() comment documents WHY (this codebase's
// test-fake CanvasRenderingContext2D mocks don't implement strokeRect) -
// a rectangle's outline is drawn via moveTo/lineTo x4/stroke, the exact
// same primitive the candle hollow-body outline already uses.
import type { ChartCandle } from "@/types/chart-data";
import { priceToY } from "../coordinate-system";
import { canvasMonoFont } from "../canvas-typography";

/** Price text for drawing labels: decimals by magnitude (BTC 2, FX 5), trailing zeros trimmed. */
export function drawingPriceText(price: number): string {
  const d = Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 100 ? 3 : Math.abs(price) >= 10 ? 4 : 5;
  return price.toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
}
import type { PanelRow } from "../panel-layout";
import type { Viewport } from "../types";
import { fractionalIndexForTime, indexToX, type IndexRange } from "../index-scale";
import { FIBONACCI_LEVELS, createDrawing, measureStats, type DrawingObject, type DrawingPoint, type DrawingPreview } from "./types";

const HANDLE_SIZE_PX = 6;
const SELECTED_LINE_WIDTH = 2;
const DEFAULT_LINE_WIDTH = 1;
const RECT_FILL_ALPHA = 0.12;
/** Width of the object being drawn right now (set per object by drawDrawingObjects). */
let activeWidth = DEFAULT_LINE_WIDTH;

function toPx(point: DrawingPoint, candles: readonly ChartCandle[], indexRange: IndexRange, viewport: Viewport, plotWidth: number, row: PanelRow): { x: number; y: number } {
  const index = fractionalIndexForTime(candles, point.time);
  return { x: indexToX(index, indexRange, plotWidth), y: row.top + priceToY(point.price, viewport, row.height) };
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex; // never throws on an unexpected format - just skips the alpha blend
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - HANDLE_SIZE_PX / 2, y - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
}

function strokeQuad(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number): void {
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + width, top);
  ctx.lineTo(left + width, top + height);
  ctx.lineTo(left, top + height);
  ctx.lineTo(left, top);
  ctx.stroke();
}

function drawHorizontalLine(ctx: CanvasRenderingContext2D, price: number, color: string, plotWidth: number, viewport: Viewport, row: PanelRow, selected: boolean): void {
  const y = row.top + priceToY(price, viewport, row.height);
  if (y < row.top - 1 || y > row.top + row.height + 1) return; // off-panel - never draw outside its own panel
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  if (selected) drawHandle(ctx, plotWidth / 2, y, color);

  // The real price value in the axis gutter, matching the latest-price
  // marker's own "always show the real number, never just a bare line"
  // convention.
  ctx.font = canvasMonoFont(12);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(drawingPriceText(price), plotWidth + 4, y);
}

function drawTrendLine(
  ctx: CanvasRenderingContext2D,
  p1: DrawingPoint,
  p2: DrawingPoint,
  color: string,
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  selected: boolean,
): void {
  const a = toPx(p1, candles, indexRange, viewport, plotWidth, row);
  const b = toPx(p2, candles, indexRange, viewport, plotWidth, row);
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (selected) {
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
  }
}

function drawRectangle(
  ctx: CanvasRenderingContext2D,
  p1: DrawingPoint,
  p2: DrawingPoint,
  color: string,
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  selected: boolean,
): void {
  const a = toPx(p1, candles, indexRange, viewport, plotWidth, row);
  const b = toPx(p2, candles, indexRange, viewport, plotWidth, row);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);

  ctx.fillStyle = hexToRgba(color, RECT_FILL_ALPHA);
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  strokeQuad(ctx, left, top, width, height);
  if (selected) {
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
  }
}

/**
 * MT5's OBJ_FIBO - horizontal price levels at each of FIBONACCI_LEVELS'
 * real ratios between p1.price and p2.price, spanning only the x range
 * between the two anchors (never the full panel width - that's what
 * visually distinguishes it from a set of independent horizontal lines).
 * Each level's own real price is labeled next to it, the same "always
 * show the real number" convention drawHorizontalLine already follows.
 */
function drawFibonacci(
  ctx: CanvasRenderingContext2D,
  p1: DrawingPoint,
  p2: DrawingPoint,
  color: string,
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  selected: boolean,
): void {
  const a = toPx(p1, candles, indexRange, viewport, plotWidth, row);
  const b = toPx(p2, candles, indexRange, viewport, plotWidth, row);
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);

  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  ctx.font = canvasMonoFont(12);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  for (const level of FIBONACCI_LEVELS) {
    const price = p1.price + (p2.price - p1.price) * level;
    const y = row.top + priceToY(price, viewport, row.height);
    if (y < row.top - 1 || y > row.top + row.height + 1) continue; // off-panel level - skip, never draw outside its own panel

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    ctx.fillStyle = color;
    const priceLabel = drawingPriceText(price);
    ctx.fillText(`${(level * 100).toFixed(1)}%  ${priceLabel}`, right + 4, y);
  }

  if (selected) {
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
  }
}

function strokeSeg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Ray (from a through b, forever) or extended line (both ways): the segment is stretched far beyond the plot and clipped by the canvas. */
function drawInfiniteLine(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, both: boolean, color: string, plotWidth: number, selected: boolean): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const k = (plotWidth * 6) / len;
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  strokeSeg(ctx, both ? a.x - dx * k : a.x, both ? a.y - dy * k : a.y, a.x + dx * k, a.y + dy * k);
  if (selected) { drawHandle(ctx, a.x, a.y, color); drawHandle(ctx, b.x, b.y, color); }
}

function drawArrow(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, selected: boolean): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  strokeSeg(ctx, a.x, a.y, b.x, b.y);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 10 + activeWidth * 2;
  for (const side of [-1, 1]) strokeSeg(ctx, b.x, b.y, b.x - head * Math.cos(ang + side * 0.45), b.y - head * Math.sin(ang + side * 0.45));
  if (selected) { drawHandle(ctx, a.x, a.y, color); drawHandle(ctx, b.x, b.y, color); }
}

function fmtDelta(n: number): string {
  return (n >= 0 ? "+" : "-") + drawingPriceText(Math.abs(n));
}

function drawMeasure(ctx: CanvasRenderingContext2D, p1: DrawingPoint, p2: DrawingPoint, candles: readonly ChartCandle[], indexRange: IndexRange, viewport: Viewport, plotWidth: number, row: PanelRow, selected: boolean): void {
  const a = toPx(p1, candles, indexRange, viewport, plotWidth, row);
  const b = toPx(p2, candles, indexRange, viewport, plotWidth, row);
  const up = p2.price >= p1.price;
  const rgb = up ? "34,197,94" : "239,68,68";
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  ctx.fillStyle = `rgba(${rgb}, 0.14)`;
  ctx.fillRect(left, top, w, h);
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
  strokeSeg(ctx, a.x, a.y, b.x, b.y);
  const s = measureStats(p1, p2, (t) => fractionalIndexForTime(candles, t));
  const text = `${fmtDelta(s.dPrice)} (${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2)}%)  ${s.bars} bars`;
  ctx.font = canvasMonoFont(12);
  const tw = text.length * 6.6 + 12;
  const lx = Math.max(2, Math.min(plotWidth - tw - 2, (a.x + b.x) / 2 - tw / 2));
  const ly = up ? top - 22 : top + h + 6;
  ctx.fillStyle = "rgba(15, 18, 24, 0.92)";
  ctx.fillRect(lx, ly, tw, 18);
  ctx.fillStyle = `rgb(${rgb})`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + 6, ly + 9);
  if (selected) { drawHandle(ctx, a.x, a.y, `rgb(${rgb})`); drawHandle(ctx, b.x, b.y, `rgb(${rgb})`); }
}

export function drawDrawingObjects(
  ctx: CanvasRenderingContext2D,
  objects: readonly DrawingObject[],
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
  selectedObjectId: string | null,
): void {
  for (const obj of objects) {
    const selected = obj.id === selectedObjectId;
    activeWidth = obj.width ?? DEFAULT_LINE_WIDTH;
    if (obj.tool === "horizontal-line") drawHorizontalLine(ctx, obj.price, obj.color, plotWidth, viewport, row, selected);
    else if (obj.tool === "trendline") drawTrendLine(ctx, obj.p1, obj.p2, obj.color, candles, indexRange, viewport, plotWidth, row, selected);
    else if (obj.tool === "fibonacci") drawFibonacci(ctx, obj.p1, obj.p2, obj.color, candles, indexRange, viewport, plotWidth, row, selected);
    else if (obj.tool === "ray" || obj.tool === "extended-line") drawInfiniteLine(ctx, toPx(obj.p1, candles, indexRange, viewport, plotWidth, row), toPx(obj.p2, candles, indexRange, viewport, plotWidth, row), obj.tool === "extended-line", obj.color, plotWidth, selected);
    else if (obj.tool === "arrow") drawArrow(ctx, toPx(obj.p1, candles, indexRange, viewport, plotWidth, row), toPx(obj.p2, candles, indexRange, viewport, plotWidth, row), obj.color, selected);
    else if (obj.tool === "measure") drawMeasure(ctx, obj.p1, obj.p2, candles, indexRange, viewport, plotWidth, row, selected);
    else if (obj.tool === "vertical-line") {
      const x = indexToX(fractionalIndexForTime(candles, obj.time), indexRange, plotWidth);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
      strokeSeg(ctx, x, row.top, x, row.top + row.height);
    } else if (obj.tool === "cross-line") {
      const c = toPx(obj.p1, candles, indexRange, viewport, plotWidth, row);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
      strokeSeg(ctx, c.x, row.top, c.x, row.top + row.height);
      strokeSeg(ctx, 0, c.y, plotWidth, c.y);
      if (selected) drawHandle(ctx, c.x, c.y, obj.color);
    } else if (obj.tool === "horizontal-ray") {
      const c = toPx(obj.p1, candles, indexRange, viewport, plotWidth, row);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = selected ? activeWidth + 1 : activeWidth;
      strokeSeg(ctx, c.x, c.y, plotWidth, c.y);
      if (selected) drawHandle(ctx, c.x, c.y, obj.color);
    } else drawRectangle(ctx, obj.p1, obj.p2, obj.color, candles, indexRange, viewport, plotWidth, row, selected);
  }
}

/** The live "rubber band" preview between a 2-click tool's first click and the second - dashed, so it's visually distinct from a committed object even before any color/selection styling applies. Never persisted; purely a draw-time preview. */
export function drawDrawingPreview(
  ctx: CanvasRenderingContext2D,
  preview: DrawingPreview,
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  color: string,
  plotWidth: number,
  row: PanelRow,
): void {
  const obj = { ...createDrawing(preview.tool, preview.p1, preview.p2, 0), color };
  ctx.setLineDash([4, 3]);
  drawDrawingObjects(ctx, [obj], candles, indexRange, viewport, plotWidth, row, null);
  ctx.setLineDash([]);
}
