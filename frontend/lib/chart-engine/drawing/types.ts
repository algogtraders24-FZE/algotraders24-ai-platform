// lib/chart-engine/drawing/types.ts
// MT5 feature-parity Phase 1/1b - Drawing Tools. Object model for chart
// annotations a user places directly (trend lines, horizontal lines,
// rectangles, Fibonacci Retracement - the most fundamental MT5 "Lines"/
// "Shapes"/"Fibonacci Tools" objects covering the large majority of
// real-world chart-annotation use, per the phased roadmap in
// docs/architecture/D2.7.11-native-chart-mt5-feature-parity-roadmap.md).
//
// Every object is anchored in REAL time/price space (never pixel space) -
// the same discipline the chart's own Viewport already follows (see
// types.ts) - so an object drawn on a candle stays anchored to that same
// candle through every pan/zoom, exactly like MT5's own drawn objects do.

export type DrawingToolId = "trendline" | "horizontal-line" | "rectangle" | "fibonacci";

export interface DrawingPoint {
  time: number;
  price: number;
}

interface DrawingObjectBase {
  id: string;
  color: string;
  createdAt: number;
}

export interface TrendLineObject extends DrawingObjectBase {
  tool: "trendline";
  p1: DrawingPoint;
  p2: DrawingPoint;
}

export interface HorizontalLineObject extends DrawingObjectBase {
  tool: "horizontal-line";
  /** Time-independent by definition - a horizontal line spans the full visible width at this one price. */
  price: number;
}

export interface RectangleObject extends DrawingObjectBase {
  tool: "rectangle";
  p1: DrawingPoint;
  p2: DrawingPoint;
}

export interface FibonacciObject extends DrawingObjectBase {
  tool: "fibonacci";
  p1: DrawingPoint;
  p2: DrawingPoint;
}

export type DrawingObject = TrendLineObject | HorizontalLineObject | RectangleObject | FibonacciObject;

/**
 * MT5's own real OBJ_FIBO default retracement ratios (verified against
 * mql5.com/metatrader5.com this session - see the roadmap doc's "Research
 * basis" section) - the 0% and 100% anchors plus the five standard
 * intermediate Fibonacci ratios. Never an invented level: this is the
 * genuine, industry-standard set every charting platform's default
 * Fibonacci Retracement tool draws.
 */
export const FIBONACCI_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Which part of an object a pointer position hit - "body" means the line/edge/fill itself (drag = move the whole object), "p1"/"p2" mean a specific endpoint handle (drag = resize that one end). Horizontal lines only ever report "body" (moving one is always a vertical shift of the whole line - they have no independent endpoints). */
export type DrawingHandle = "p1" | "p2" | "body";

export interface DrawingHit {
  objectId: string;
  handle: DrawingHandle;
}

/** The in-progress state of a 2-click placement (trendline/rectangle/fibonacci) between the first click and the second - rendered as a live "rubber band" preview, never persisted until the second click commits it. */
export interface DrawingPreview {
  tool: "trendline" | "rectangle" | "fibonacci";
  p1: DrawingPoint;
  p2: DrawingPoint;
}

export const DRAWING_TOOL_DEFAULT_COLOR: Record<DrawingToolId, string> = {
  trendline: "#f59e0b",
  "horizontal-line": "#f472b6",
  rectangle: "#60a5fa",
  fibonacci: "#a78bfa",
};

export const DRAWING_TOOL_LABEL: Record<DrawingToolId, string> = {
  trendline: "Trend Line",
  "horizontal-line": "Horizontal Line",
  rectangle: "Rectangle",
  fibonacci: "Fibonacci Retracement",
};

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTrendLine(p1: DrawingPoint, p2: DrawingPoint, nowMs: number): TrendLineObject {
  return { id: newId(), tool: "trendline", p1, p2, color: DRAWING_TOOL_DEFAULT_COLOR.trendline, createdAt: nowMs };
}

export function createHorizontalLine(price: number, nowMs: number): HorizontalLineObject {
  return { id: newId(), tool: "horizontal-line", price, color: DRAWING_TOOL_DEFAULT_COLOR["horizontal-line"], createdAt: nowMs };
}

export function createRectangle(p1: DrawingPoint, p2: DrawingPoint, nowMs: number): RectangleObject {
  return { id: newId(), tool: "rectangle", p1, p2, color: DRAWING_TOOL_DEFAULT_COLOR.rectangle, createdAt: nowMs };
}

export function createFibonacci(p1: DrawingPoint, p2: DrawingPoint, nowMs: number): FibonacciObject {
  return { id: newId(), tool: "fibonacci", p1, p2, color: DRAWING_TOOL_DEFAULT_COLOR.fibonacci, createdAt: nowMs };
}
