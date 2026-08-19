// lib/chart-engine/drawing/geometry.ts
// Pure hit-testing/geometry for drawn objects. No DOM, no React, no
// mutation - every function takes the current Viewport/plot dimensions
// explicitly and derives pixel positions fresh via the SAME
// coordinate-system.ts functions the candle/crosshair renderer already
// uses, never a second time<->pixel conversion.
import { priceToY, timeToX, xToTime, yToPrice } from "../coordinate-system";
import type { Viewport } from "../types";
import type { DrawingHit, DrawingObject, DrawingPoint } from "./types";

const HANDLE_RADIUS_PX = 7;
const BODY_TOLERANCE_PX = 5;

export function pointToPixel(point: DrawingPoint, viewport: Viewport, plotWidth: number, plotHeight: number): { x: number; y: number } {
  return { x: timeToX(point.time, viewport, plotWidth), y: priceToY(point.price, viewport, plotHeight) };
}

export function pixelToPoint(x: number, y: number, viewport: Viewport, plotWidth: number, plotHeight: number): DrawingPoint {
  return { time: xToTime(x, viewport, plotWidth), price: yToPrice(y, viewport, plotHeight) };
}

/** Shortest distance from (px,py) to the segment [a,b], in pixels. Standard clamped-projection formula - degenerates cleanly to point-distance when a===b. */
export function distancePointToSegmentPx(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function hitTestOne(obj: DrawingObject, px: number, py: number, viewport: Viewport, plotWidth: number, plotHeight: number): DrawingHit["handle"] | null {
  if (obj.tool === "horizontal-line") {
    const y = priceToY(obj.price, viewport, plotHeight);
    return Math.abs(py - y) <= BODY_TOLERANCE_PX ? "body" : null;
  }

  const a = pointToPixel(obj.p1, viewport, plotWidth, plotHeight);
  const b = pointToPixel(obj.p2, viewport, plotWidth, plotHeight);
  if (Math.hypot(px - a.x, py - a.y) <= HANDLE_RADIUS_PX) return "p1";
  if (Math.hypot(px - b.x, py - b.y) <= HANDLE_RADIUS_PX) return "p2";

  if (obj.tool === "trendline") {
    return distancePointToSegmentPx(px, py, a.x, a.y, b.x, b.y) <= BODY_TOLERANCE_PX ? "body" : null;
  }

  // Rectangle - hit if inside the fill or near an edge (both count as
  // "body": dragging anywhere inside a rectangle moves the whole shape,
  // matching MT5's own rectangle drag behavior).
  const left = Math.min(a.x, b.x) - BODY_TOLERANCE_PX;
  const right = Math.max(a.x, b.x) + BODY_TOLERANCE_PX;
  const top = Math.min(a.y, b.y) - BODY_TOLERANCE_PX;
  const bottom = Math.max(a.y, b.y) + BODY_TOLERANCE_PX;
  return px >= left && px <= right && py >= top && py <= bottom ? "body" : null;
}

/** Topmost (most-recently-created) object first, so an overlapping click resolves to whatever was drawn last - the natural expectation. Returns null when nothing was hit within tolerance. */
export function hitTestObjects(
  objects: readonly DrawingObject[],
  px: number,
  py: number,
  viewport: Viewport,
  plotWidth: number,
  plotHeight: number,
): DrawingHit | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const handle = hitTestOne(objects[i], px, py, viewport, plotWidth, plotHeight);
    if (handle) return { objectId: objects[i].id, handle };
  }
  return null;
}

/** Applies a real time/price delta (never a pixel delta - objects are anchored in real space) to whichever part of the object the drag started on. Returns a NEW object (never mutates its argument), matching this codebase's pure-function convention throughout lib/chart-engine. */
export function applyDrag(obj: DrawingObject, handle: DrawingHit["handle"], deltaTime: number, deltaPrice: number): DrawingObject {
  if (obj.tool === "horizontal-line") {
    return { ...obj, price: obj.price + deltaPrice };
  }
  if (handle === "p1") return { ...obj, p1: { time: obj.p1.time + deltaTime, price: obj.p1.price + deltaPrice } };
  if (handle === "p2") return { ...obj, p2: { time: obj.p2.time + deltaTime, price: obj.p2.price + deltaPrice } };
  // "body" - translate both endpoints together, preserving shape/length.
  return {
    ...obj,
    p1: { time: obj.p1.time + deltaTime, price: obj.p1.price + deltaPrice },
    p2: { time: obj.p2.time + deltaTime, price: obj.p2.price + deltaPrice },
  };
}
