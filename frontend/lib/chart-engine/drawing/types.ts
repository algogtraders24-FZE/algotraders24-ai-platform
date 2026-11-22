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

export type TwoPointToolId = "trendline" | "ray" | "extended-line" | "arrow" | "rectangle" | "fibonacci" | "measure";
export type OnePointToolId = "horizontal-line" | "vertical-line" | "cross-line" | "horizontal-ray";
export type DrawingToolId = TwoPointToolId | OnePointToolId;

const ONE_POINT_TOOLS: readonly string[] = ["horizontal-line", "vertical-line", "cross-line", "horizontal-ray"];
export function isOnePointTool(tool: DrawingToolId): tool is OnePointToolId {
  return ONE_POINT_TOOLS.includes(tool);
}

export interface DrawingPoint {
  time: number;
  price: number;
}

interface DrawingObjectBase {
  id: string;
  color: string;
  createdAt: number;
  /** Line width in px (1-8). Optional, so drawings saved before this field existed stay valid. */
  width?: number;
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

export interface RayObject extends DrawingObjectBase { tool: "ray"; p1: DrawingPoint; p2: DrawingPoint }
export interface ExtendedLineObject extends DrawingObjectBase { tool: "extended-line"; p1: DrawingPoint; p2: DrawingPoint }
export interface ArrowObject extends DrawingObjectBase { tool: "arrow"; p1: DrawingPoint; p2: DrawingPoint }
export interface MeasureObject extends DrawingObjectBase { tool: "measure"; p1: DrawingPoint; p2: DrawingPoint }
/** A vertical line is time-only. */
export interface VerticalLineObject extends DrawingObjectBase { tool: "vertical-line"; time: number }
export interface CrossLineObject extends DrawingObjectBase { tool: "cross-line"; p1: DrawingPoint }
/** From p1 to the right edge at p1's price. */
export interface HorizontalRayObject extends DrawingObjectBase { tool: "horizontal-ray"; p1: DrawingPoint }

export type DrawingObject =
  | TrendLineObject | HorizontalLineObject | RectangleObject | FibonacciObject
  | RayObject | ExtendedLineObject | ArrowObject | MeasureObject | VerticalLineObject | CrossLineObject | HorizontalRayObject;

/** Numbers shown by the Measure tool, from two anchors. Bars use the gapless candle index, so weekends never count as bars. */
export function measureStats(p1: DrawingPoint, p2: DrawingPoint, indexOf: (time: number) => number): { dPrice: number; pct: number; bars: number; ms: number } {
  const dPrice = p2.price - p1.price;
  return { dPrice, pct: p1.price !== 0 ? (dPrice / p1.price) * 100 : 0, bars: Math.round(Math.abs(indexOf(p2.time) - indexOf(p1.time))), ms: Math.abs(p2.time - p1.time) };
}

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
  tool: TwoPointToolId;
  p1: DrawingPoint;
  p2: DrawingPoint;
}

export const DRAWING_TOOL_DEFAULT_COLOR: Record<DrawingToolId, string> = {
  ray: "#f59e0b",
  "extended-line": "#f59e0b",
  arrow: "#e5e7eb",
  measure: "#60a5fa",
  "vertical-line": "#60a5fa",
  "cross-line": "#9aa0ae",
  "horizontal-ray": "#f472b6",
  trendline: "#f59e0b",
  "horizontal-line": "#f472b6",
  rectangle: "#60a5fa",
  fibonacci: "#a78bfa",
};

export const DRAWING_TOOL_LABEL: Record<DrawingToolId, string> = {
  ray: "Ray",
  "extended-line": "Extended Line",
  arrow: "Arrow",
  measure: "Measure",
  "vertical-line": "Vertical Line",
  "cross-line": "Cross Line",
  "horizontal-ray": "Horizontal Ray",
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

/** One factory for every tool: one-point tools use p1 only (vertical-line uses its time). */
export function createDrawing(tool: DrawingToolId, p1: DrawingPoint, p2: DrawingPoint, nowMs: number): DrawingObject {
  const base = { id: newId(), color: DRAWING_TOOL_DEFAULT_COLOR[tool], createdAt: nowMs };
  switch (tool) {
    case "horizontal-line": return { ...base, tool, price: p1.price };
    case "vertical-line": return { ...base, tool, time: p1.time };
    case "cross-line": return { ...base, tool, p1 };
    case "horizontal-ray": return { ...base, tool, p1 };
    default: return { ...base, tool, p1, p2 };
  }
}
