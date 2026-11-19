// lib/chart-engine/annotations/render.ts
// Canvas draw layer for Professional Mode annotations. Same discipline as drawing-renderer.ts: a pure function of
// its inputs, anchored in time / price space through the SAME gapless index-scale functions the candles use, and
// only moveTo / lineTo / stroke / fillRect / fillText (the test-fake canvas mocks do not implement strokeRect).
import type { ChartCandle } from "@/types/chart-data";
import { priceToY } from "../coordinate-system";
import { canvasMonoFont } from "../canvas-typography";
import type { PanelRow } from "../panel-layout";
import type { Viewport } from "../types";
import { fractionalIndexForTime, indexToX, type IndexRange } from "../index-scale";
import type { AnnotationLayers, ChartAnnotation } from "./types";

const GREEN = "34,197,94";
const RED = "239,68,68";
const BLUE = "96,165,250";
const AMBER = "245,158,11";
const GREY = "148,163,184";

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly ChartAnnotation[],
  layers: AnnotationLayers,
  candles: readonly ChartCandle[],
  indexRange: IndexRange,
  viewport: Viewport,
  plotWidth: number,
  row: PanelRow,
): void {
  if (candles.length === 0) return;
  const X = (t: number) => Math.max(0, Math.min(plotWidth, indexToX(fractionalIndexForTime(candles, t), indexRange, plotWidth)));
  const Y = (p: number) => row.top + priceToY(p, viewport, row.height);
  const inRow = (y: number) => y >= row.top - 2 && y <= row.top + row.height + 2;
  const clampY = (y: number) => Math.max(row.top, Math.min(row.top + row.height, y));

  const label = (text: string, x: number, y: number, rgb: string, align: CanvasTextAlign = "left") => {
    ctx.font = canvasMonoFont(10);
    const w = text.length * 6.2 + 8;
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(15, 18, 24, 0.82)"; // dark pill behind the text, like Pipflow
    ctx.fillRect(left, y - 10, w, 14);
    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${rgb}, 1)`;
    ctx.fillText(text, left + 4, y);
    ctx.textAlign = "left";
  };
  const line = (x1: number, y1: number, x2: number, y2: number, rgb: string, alpha: number, width = 1) => {
    ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (const a of annotations) {
    if (!layers[a.group]) continue;

    if (a.type === "zone") {
      const rgb = a.kind === "premium" ? RED : a.kind === "discount" ? GREEN : a.kind === "ote" ? AMBER : a.kind === "fvg" ? BLUE : a.bias === "bullish" ? GREEN : RED;
      const x1 = X(a.startTime);
      const x2 = a.endTime === null ? plotWidth : X(a.endTime);
      const yTop = clampY(Y(a.high));
      const yBot = clampY(Y(a.low));
      if (x2 <= x1 || yBot <= yTop) continue;
      const soft = a.kind === "premium" || a.kind === "discount";
      ctx.fillStyle = `rgba(${rgb}, ${soft ? 0.05 : a.kind === "ote" ? 0.14 : 0.16})`;
      ctx.fillRect(x1, yTop, x2 - x1, yBot - yTop);
      if (!soft) {
        line(x1, yTop, x2, yTop, rgb, 0.55);
        line(x1, yBot, x2, yBot, rgb, 0.55);
      }
      if (yBot - yTop > 11) label(a.label, x1 + 4, yTop + 11, rgb);
    } else if (a.type === "level") {
      const y = Y(a.price);
      if (!inRow(y)) continue;
      ctx.setLineDash?.([4, 4]);
      line(X(a.startTime), y, plotWidth, y, GREY, 0.55);
      ctx.setLineDash?.([]);
      label(a.label, plotWidth - 4, y - 3, GREY, "right");
    } else if (a.type === "structure") {
      const y = Y(a.price);
      if (!inRow(y)) continue;
      const rgb = a.bias === "bullish" ? GREEN : RED;
      const x1 = X(a.fromTime);
      const x2 = X(a.toTime);
      ctx.setLineDash?.([5, 3]);
      line(x1, y, x2, y, rgb, 0.9);
      ctx.setLineDash?.([]);
      label(a.label, (x1 + x2) / 2, a.bias === "bullish" ? y - 4 : y + 12, rgb, "center");
    } else if (a.type === "marker") {
      const y = Y(a.price);
      if (!inRow(y)) continue;
      const x = X(a.time);
      const rgb = a.bias === "bullish" ? GREEN : RED;
      // small triangle drawn as a filled rectangle stem + label - no path fills needed
      ctx.fillStyle = `rgba(${rgb}, 0.9)`;
      ctx.fillRect(x - 3, a.bias === "bullish" ? y + 3 : y - 8, 6, 5);
      label("Sweep", x, a.bias === "bullish" ? y + 20 : y - 12, rgb, "center");
    } else if (a.type === "pattern") {
      const rgb = a.kind === "doubleTop" ? RED : GREEN;
      const x1 = X(a.t1), x2 = X(a.t2);
      const y1 = Y(a.price1), y2 = Y(a.price2), yn = Y(a.neckline);
      if (!inRow(y1) && !inRow(y2)) continue;
      line(x1, y1, x2, y2, rgb, 0.9, 1.5);
      ctx.setLineDash?.([3, 3]);
      line(x1, yn, Math.min(plotWidth, x2 + 60), yn, rgb, 0.7);
      ctx.setLineDash?.([]);
      label(a.label, (x1 + x2) / 2, a.kind === "doubleTop" ? Math.min(y1, y2) - 6 : Math.max(y1, y2) + 14, rgb, "center");
    } else if (a.type === "session") {
      const x = X(a.time);
      const rgb = a.session === "LDN" ? BLUE : AMBER;
      ctx.setLineDash?.([2, 4]);
      line(x, row.top, x, row.top + row.height, rgb, 0.35);
      ctx.setLineDash?.([]);
      label(a.session, x + 3, row.top + 11, rgb);
    }
  }
}
