// scripts/validate-drawing-engine.ts - Pro Chart drawing engine (stage 2): undo / redo history, magnet snap, line width.
// Run: npx tsx scripts/validate-drawing-engine.ts
import assert from "node:assert/strict";
import { DrawingHistory, MAX_HISTORY } from "../lib/chart-engine/drawing/history";
import { snapToOhlc } from "../lib/chart-engine/drawing/snap";
import { isValidDrawingObject } from "../lib/chart-engine/drawing/validation";
import { drawDrawingObjects } from "../lib/chart-engine/drawing/drawing-renderer";
import { createHorizontalLine, createTrendLine, type DrawingObject } from "../lib/chart-engine/drawing/types";
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
