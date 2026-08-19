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
import type { PanelRow } from "../panel-layout";
import type { Viewport } from "../types";
import { fractionalIndexForTime, indexToX, type IndexRange } from "../index-scale";
import type { DrawingObject, DrawingPoint, DrawingPreview } from "./types";

const HANDLE_SIZE_PX = 6;
const SELECTED_LINE_WIDTH = 2;
const DEFAULT_LINE_WIDTH = 1;
const RECT_FILL_ALPHA = 0.12;

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
  ctx.lineWidth = selected ? SELECTED_LINE_WIDTH : DEFAULT_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  if (selected) drawHandle(ctx, plotWidth / 2, y, color);

  // The real price value in the axis gutter, matching the latest-price
  // marker's own "always show the real number, never just a bare line"
  // convention.
  ctx.font = canvasMonoFont(11);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(price.toFixed(5).replace(/0+$/, "").replace(/\.$/, ""), plotWidth + 4, y);
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
  ctx.lineWidth = selected ? SELECTED_LINE_WIDTH : DEFAULT_LINE_WIDTH;
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
  ctx.lineWidth = selected ? SELECTED_LINE_WIDTH : DEFAULT_LINE_WIDTH;
  strokeQuad(ctx, left, top, width, height);
  if (selected) {
    drawHandle(ctx, a.x, a.y, color);
    drawHandle(ctx, b.x, b.y, color);
  }
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
    if (obj.tool === "horizontal-line") drawHorizontalLine(ctx, obj.price, obj.color, plotWidth, viewport, row, selected);
    else if (obj.tool === "trendline") drawTrendLine(ctx, obj.p1, obj.p2, obj.color, candles, indexRange, viewport, plotWidth, row, selected);
    else drawRectangle(ctx, obj.p1, obj.p2, obj.color, candles, indexRange, viewport, plotWidth, row, selected);
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
  const a = toPx(preview.p1, candles, indexRange, viewport, plotWidth, row);
  const b = toPx(preview.p2, candles, indexRange, viewport, plotWidth, row);
  ctx.strokeStyle = color;
  ctx.lineWidth = DEFAULT_LINE_WIDTH;
  ctx.setLineDash([4, 3]);
  if (preview.tool === "trendline") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    strokeQuad(ctx, left, top, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  ctx.setLineDash([]);
}
