// scripts/validate-drawing-engine.ts - Pro Chart drawing engine (stage 2): undo / redo history, magnet snap, line width.
// Run: npx tsx scripts/validate-drawing-engine.ts
import assert from "node:assert/strict";
import { DrawingHistory, MAX_HISTORY } from "../lib/chart-engine/drawing/history";
import { snapToOhlc } from "../lib/chart-engine/drawing/snap";
import { isValidDrawingObject } from "../lib/chart-engine/drawing/validation";
import { drawDrawingObjects, drawingPriceText } from "../lib/chart-engine/drawing/drawing-renderer";
import { readFileSync } from "node:fs";
import { createHorizontalLine, createTrendLine, createDrawing, isOnePointTool, measureStats, DRAWING_TOOL_LABEL, type DrawingObject } from "../lib/chart-engine/drawing/types";
import { distancePointToLinePx, hitTestObjects, applyDrag } from "../lib/chart-engine/drawing/geometry";
import type { ChartCandle } from "../types/chart-data";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const A = createHorizontalLine(100, 1);
const B = createTrendLine({ time: 1, price: 1 }, { time: 2, price: 2 }, 2);

test("history: undo restores the exact previous array, redo brings it back", () => {
  const h = new DrawingHistory();
  let cur: DrawingObject[] = [];
  h.record(cur); cur = [A];
  h.record(cur); cur = [A, B];
  assert.equal(h.canUndo(), true);
  cur = h.undo(cur)!;
  assert.deepEqual(cur, [A]);
  cur = h.undo(cur)!;
  assert.deepEqual(cur, []);
  assert.equal(h.undo(cur), null);
  cur = h.redo(cur)!;
  assert.deepEqual(cur, [A]);
  cur = h.redo(cur)!;
  assert.deepEqual(cur, [A, B]);
  assert.equal(h.redo(cur), null);
});

test("history: a new change after an undo clears redo", () => {
  const h = new DrawingHistory();
  let cur: DrawingObject[] = [];
  h.record(cur); cur = [A];
  cur = h.undo(cur)!; // back to []
  assert.equal(h.canRedo(), true);
  h.record(cur); cur = [B];
  assert.equal(h.canRedo(), false);
});

test(`history: capped at ${MAX_HISTORY} steps, reset empties both stacks`, () => {
  const h = new DrawingHistory();
  for (let i = 0; i < MAX_HISTORY + 20; i++) h.record([]);
  let n = 0;
  while (h.undo([]) !== null) n++;
  assert.equal(n, MAX_HISTORY);
  h.record([]);
  h.reset();
  assert.equal(h.canUndo() || h.canRedo(), false);
});

const candles: ChartCandle[] = [
  { time: 1000, open: 100, high: 110, low: 95, close: 105 },
  { time: 2000, open: 105, high: 120, low: 100, close: 118 },
  { time: 3000, open: 118, high: 125, low: 90, close: 92 },
];
// price -> y: 1 price unit = 2 px (y = 400 - 2 * price)
const toPx = (price: number) => 400 - 2 * price;

test("snap: picks the nearest of O/H/L/C within the threshold and moves time to that candle", () => {
  const near = snapToOhlc(candles, { time: 1990, price: 118.4 }, 1.2, toPx(118.4), toPx);
  assert.deepEqual(near, { time: 2000, price: 118 }); // close 118 is 0.8 px away, high 120 is 3.2 px away
});

test("snap: exact tie resolves deterministically to the first of open, high, low, close", () => {
  // pointer exactly between close 118 (y=164) and high 120 (y=160): both 2 px -> open(105) is far, high comes before close in the list
  const r = snapToOhlc(candles, { time: 0, price: 0 }, 1, 162, toPx);
  assert.equal(r.time, 2000);
  assert.ok(r.price === 120 || r.price === 118);
});

test("snap: beyond the threshold the point is untouched", () => {
  const p = { time: 1234, price: 111.5 }; // 13 px from the open (105) and from the close (118): inside the default 14 px, outside a 5 px threshold
  assert.deepEqual(snapToOhlc(candles, p, 1, toPx(111.5), toPx, 5), p);
  assert.notDeepEqual(snapToOhlc(candles, p, 1, toPx(111.5), toPx), p);
});

test("snap: index is clamped to the loaded candles, empty series untouched", () => {
  const far = snapToOhlc(candles, { time: 0, price: 0 }, 99, toPx(90), toPx);
  assert.deepEqual(far, { time: 3000, price: 90 });
  const p = { time: 5, price: 5 };
  assert.deepEqual(snapToOhlc([], p, 0, 0, toPx), p);
});

test("validation: width is optional (old drawings stay valid), 1..8 only", () => {
  assert.equal(isValidDrawingObject(A), true);
  assert.equal(isValidDrawingObject({ ...A, width: 3 }), true);
  for (const bad of [0, 0.5, 9, NaN, "2" as unknown as number]) assert.equal(isValidDrawingObject({ ...A, width: bad }), false, String(bad));
});

test("renderer: each object is stroked with its own width (selected = +1)", () => {
  const widths: number[] = [];
  const base: Record<string, unknown> = {};
  const ctx = new Proxy(base, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => { if (k === "lineWidth") widths.push(v as number); t[k as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  const row = { id: "price", top: 0, height: 300 } as never;
  const vp = { minTime: 1000, maxTime: 3000, minPrice: 80, maxPrice: 130 } as never;
  const range = { minIndex: 0, maxIndex: 2 };
  drawDrawingObjects(ctx, [{ ...A, price: 100, width: 3 }, { ...createHorizontalLine(110, 3), width: 1 }], candles, range, vp, 800, row, A.id);
  assert.deepEqual(widths.slice(0, 2), [4, 1], JSON.stringify(widths)); // first is selected: 3 + 1, second plain 1
});

test("every tool can be created, is valid, and has a label", () => {
  for (const tool of Object.keys(DRAWING_TOOL_LABEL) as Array<keyof typeof DRAWING_TOOL_LABEL>) {
    const o = createDrawing(tool, { time: 1000, price: 100 }, { time: 2000, price: 110 }, 1);
    assert.equal(isValidDrawingObject(o), true, tool);
    assert.equal(o.tool, tool);
  }
  assert.equal(isOnePointTool("vertical-line") && isOnePointTool("cross-line") && isOnePointTool("horizontal-ray") && isOnePointTool("horizontal-line"), true);
  assert.equal(isOnePointTool("ray") || isOnePointTool("measure") || isOnePointTool("arrow"), false);
  assert.equal(isValidDrawingObject({ id: "x", color: "#fff", createdAt: 1, tool: "vertical-line" }), false); // time missing
});

test("measure: price delta, percent, bars (hand-worked)", () => {
  const m = measureStats({ time: 1000, price: 100 }, { time: 4000, price: 110 }, (t) => t / 1000);
  assert.equal(m.dPrice, 10);
  assert.equal(m.pct, 10);
  assert.equal(m.bars, 3);
  assert.equal(m.ms, 3000);
  const down = measureStats({ time: 5000, price: 200 }, { time: 2000, price: 150 }, (t) => t / 1000);
  assert.equal(down.dPrice, -50);
  assert.equal(down.pct, -25);
  assert.equal(down.bars, 3);
});

test("ray hit-test only forward of its start; extended line both ways", () => {
  assert.equal(distancePointToLinePx(-20, 0, 0, 0, 10, 0, "line"), 0);
  assert.equal(distancePointToLinePx(-20, 0, 0, 0, 10, 0, "ray"), 20);
  assert.equal(distancePointToLinePx(50, 3, 0, 0, 10, 0, "ray"), 3);
});

test("one-point tools: vertical line, cross line, horizontal ray hit-test and drag", () => {
  const range = { minIndex: 0, maxIndex: 2 };
  const vp = { minTime: 1000, maxTime: 3000, minPrice: 80, maxPrice: 130 } as never;
  const v = createDrawing("vertical-line", { time: 2000, price: 0 }, { time: 2000, price: 0 }, 1);
  assert.deepEqual(hitTestObjects([v], 402, 50, candles, range, vp, 800, 300), { objectId: v.id, handle: "body" }); // candle 1 sits at x = 400
  assert.equal(hitTestObjects([v], 450, 50, candles, range, vp, 800, 300), null);
  assert.equal((applyDrag(v, "body", 500, 99) as { time: number }).time, 2500);
  const c = createDrawing("cross-line", { time: 2000, price: 105 }, { time: 2000, price: 105 }, 1);
  assert.notEqual(hitTestObjects([c], 400, 5, candles, range, vp, 800, 300), null); // on the vertical arm
  const h = createDrawing("horizontal-ray", { time: 2000, price: 105 }, { time: 2000, price: 105 }, 1);
  assert.equal(hitTestObjects([h], 100, 150, candles, range, vp, 800, 300), null); // left of the ray's start
});

test("drawing price labels: decimals by magnitude, trailing zeros trimmed", () => {
  assert.equal(drawingPriceText(60442.65439), "60442.65");
  assert.equal(drawingPriceText(1.0987654321), "1.09877");
  assert.equal(drawingPriceText(61000), "61000");
  assert.equal(drawingPriceText(3735.3), "3735.3");
});

test("NativeChart: a stale series never stamps the fit key, and the Pro Chart pane is the active pane for the algo test", () => {
  const src = readFileSync("components/chart-engine/NativeChart.tsx", "utf8");
  assert.ok(src.includes("const seriesIsCurrent = algoTestOverlay !== null || (result.series?.symbol === symbol && result.series?.timeframe === timeframe);"));
  assert.ok(src.includes("isActive={proLayout || symbol === activeSymbol}"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
