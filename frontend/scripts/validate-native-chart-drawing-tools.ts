// scripts/validate-native-chart-drawing-tools.ts
// MT5 feature-parity Phase 1/1b - Drawing Tools (trend line, horizontal
// line, rectangle, Fibonacci Retracement). Standalone, assert-based verification, matching
// every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:native-chart-drawing-tools`.
//
// The pure engine core (lib/chart-engine/drawing/*) is tested directly as
// deterministic functions. The renderer (needs a CanvasRenderingContext2D)
// is exercised against the SAME minimal recording fake
// validate-native-chart-engine.ts already established - deliberately
// re-implemented here rather than imported (these validate-*.ts scripts
// are standalone entry points, never importing from one another) but kept
// byte-identical in shape so a method this fake doesn't implement (e.g.
// strokeRect - see drawing-renderer.ts's own header comment on why it's
// never called) would fail loudly here too, not just in production.
import assert from "node:assert/strict";

import {
  createHorizontalLine,
  createRectangle,
  createTrendLine,
  createFibonacci,
  DRAWING_TOOL_DEFAULT_COLOR,
  FIBONACCI_LEVELS,
  type DrawingObject,
} from "../lib/chart-engine/drawing/types";
import { applyDrag, distancePointToSegmentPx, hitTestObjects, pixelToPoint, pointToPixel } from "../lib/chart-engine/drawing/geometry";
import { readDrawingObjects, writeDrawingObjects } from "../lib/chart-engine/drawing/store";
import { drawDrawingObjects, drawDrawingPreview } from "../lib/chart-engine/drawing/drawing-renderer";
import { renderChart } from "../lib/chart-engine/renderer";
import { fitToData } from "../lib/chart-engine/viewport";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { indexRangeForViewport } from "../lib/chart-engine/index-scale";
import type { Viewport } from "../lib/chart-engine/types";
import type { PanelRow } from "../lib/chart-engine/panel-layout";
import type { ChartCandle } from "../types/chart-data";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const VIEWPORT: Viewport = { minTime: 0, maxTime: 1000, minPrice: 100, maxPrice: 200 };
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 500;
const PRICE_ROW: PanelRow = { id: "price", top: 0, height: PLOT_HEIGHT };
// Gapless x-axis (this session) - geometry/drawing-renderer now position
// everything by candle INDEX, not raw time, so the tests need a real
// candles fixture spanning VIEWPORT's time range. 11 candles evenly
// spaced every 100ms (0, 100, 200, ..., 1000) means every time value the
// tests below already used (200/500/800/900) lands EXACTLY on a real
// candle index (2/5/8/9) - fractional-index math resolves to a clean
// integer, keeping every existing pixel-position assertion unchanged.
const CANDLES: ChartCandle[] = Array.from({ length: 11 }, (_, i) => ({ time: i * 100, open: 100, high: 110, low: 90, close: 100 }));
const INDEX_RANGE = indexRangeForViewport(CANDLES, VIEWPORT);

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    stroke: () => calls.push("stroke"),
    fillText: () => calls.push("fillText"),
    setLineDash: () => calls.push("setLineDash"),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

// Sprint D2.7.11 Phase 1b - store.ts is now a thin fetch wrapper around
// GET/PUT /api/private/chart-drawings (DB-backed, durable persistence -
// see store.ts's own header comment for why this replaced sessionStorage).
// This script runs under plain Node with no real server to call, so
// `fetch` is stubbed with a minimal in-memory fake that mirrors the real
// route's exact request/response shape (ApiResponse's {status,data} envelope)
// closely enough that store.ts's own response-parsing code path is
// genuinely exercised, not bypassed.
function installFakeFetch(): void {
  const data = new Map<string, unknown>();
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname !== "/api/private/chart-drawings") {
      return new Response(JSON.stringify({ status: "error" }), { status: 404 });
    }
    if (!init || init.method === undefined) {
      const symbol = url.searchParams.get("symbol") ?? "";
      const timeframe = url.searchParams.get("timeframe") ?? "";
      const objects = data.get(`${symbol}|${timeframe}`) ?? [];
      return new Response(JSON.stringify({ status: "ok", data: { objects } }), { status: 200 });
    }
    if (init.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { symbol: string; timeframe: string; objects: unknown };
      data.set(`${body.symbol}|${body.timeframe}`, body.objects);
      return new Response(JSON.stringify({ status: "ok", data: { objects: body.objects } }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "error" }), { status: 404 });
  }) as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fakeFetch;
}

function makeCandles(count: number): ChartCandle[] {
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ time: i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 });
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== Geometry: pixel<->real round-trip ===");

  test("pointToPixel/pixelToPoint round-trip is lossless for a point inside the viewport", () => {
    const point = { time: 500, price: 150 };
    const px = pointToPixel(point, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const back = pixelToPoint(px.x, px.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.ok(Math.abs(back.time - point.time) < 1e-6);
    assert.ok(Math.abs(back.price - point.price) < 1e-6);
  });

  test("distancePointToSegmentPx: 0 for a point ON the segment", () => {
    assert.equal(distancePointToSegmentPx(50, 50, 0, 0, 100, 100), 0);
  });

  test("distancePointToSegmentPx: clamps to the nearest endpoint beyond the segment's ends", () => {
    const d = distancePointToSegmentPx(-10, 0, 0, 0, 100, 0);
    assert.equal(d, 10);
  });

  test("distancePointToSegmentPx: degenerates cleanly to point-distance when the segment has zero length", () => {
    const d = distancePointToSegmentPx(3, 4, 0, 0, 0, 0);
    assert.equal(d, 5);
  });

  console.log("\n=== Geometry: hit-testing ===");

  test("hitTestObjects: a click on a trend line's p1 endpoint hits 'p1', not 'body'", () => {
    const line = createTrendLine({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000);
    const px = pointToPixel(line.p1, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const hit = hitTestObjects([line], px.x, px.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(hit, { objectId: line.id, handle: "p1" });
  });

  test("hitTestObjects: a click on a trend line's p2 endpoint hits 'p2'", () => {
    const line = createTrendLine({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000);
    const px = pointToPixel(line.p2, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const hit = hitTestObjects([line], px.x, px.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(hit, { objectId: line.id, handle: "p2" });
  });

  test("hitTestObjects: a click on the middle of a trend line's segment hits 'body'", () => {
    const line = createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 1000);
    const mid = pointToPixel({ time: 500, price: 150 }, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const hit = hitTestObjects([line], mid.x, mid.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(hit, { objectId: line.id, handle: "body" });
  });

  test("hitTestObjects: a click far from any object returns null - never a false positive", () => {
    const line = createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 1000);
    const hit = hitTestObjects([line], 5, 5, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.equal(hit, null);
  });

  test("hitTestObjects: a horizontal line hits 'body' anywhere along its full width at its price, never 'p1'/'p2' (it has no independent endpoints)", () => {
    const hLine = createHorizontalLine(160, 1000);
    const y = pointToPixel({ time: 0, price: 160 }, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT).y;
    const hit = hitTestObjects([hLine], 999, y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(hit, { objectId: hLine.id, handle: "body" });
  });

  test("hitTestObjects: a rectangle hits 'body' for a click INSIDE its area, not just on the border", () => {
    const rect = createRectangle({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000);
    const center = pointToPixel({ time: 500, price: 150 }, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const hit = hitTestObjects([rect], center.x, center.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(hit, { objectId: rect.id, handle: "body" });
  });

  test("hitTestObjects: overlapping objects resolve to the TOPMOST (last-created) one, matching the natural expectation of clicking the thing visually on top", () => {
    const bottom = createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 1000);
    const top = createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 2000);
    const mid = pointToPixel({ time: 500, price: 150 }, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const hit = hitTestObjects([bottom, top], mid.x, mid.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.equal(hit?.objectId, top.id);
  });

  test("hitTestObjects: a Fibonacci Retracement hits 'body' for a click inside its p1/p2 extent, and 'p1'/'p2' at its two real anchor handles - the same bounding-box treatment as a rectangle, since its real anchors ARE exactly p1/p2", () => {
    const fib = createFibonacci({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000);
    const center = pointToPixel({ time: 500, price: 150 }, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const bodyHit = hitTestObjects([fib], center.x, center.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(bodyHit, { objectId: fib.id, handle: "body" });

    const p1px = pointToPixel(fib.p1, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    const p1Hit = hitTestObjects([fib], p1px.x, p1px.y, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PLOT_HEIGHT);
    assert.deepEqual(p1Hit, { objectId: fib.id, handle: "p1" });
  });

  console.log("\n=== Geometry: dragging ===");

  test("applyDrag on a trend line's 'p1' handle moves ONLY p1 - p2 stays exactly fixed", () => {
    const line = createTrendLine({ time: 100, price: 100 }, { time: 900, price: 200 }, 1000);
    const moved = applyDrag(line, "p1", 50, 10) as typeof line;
    assert.deepEqual(moved.p1, { time: 150, price: 110 });
    assert.deepEqual(moved.p2, line.p2);
  });

  test("applyDrag on a trend line's 'body' translates BOTH endpoints by the same delta - shape/length preserved", () => {
    const line = createTrendLine({ time: 100, price: 100 }, { time: 900, price: 200 }, 1000);
    const moved = applyDrag(line, "body", 50, 10) as typeof line;
    assert.deepEqual(moved.p1, { time: 150, price: 110 });
    assert.deepEqual(moved.p2, { time: 950, price: 210 });
  });

  test("applyDrag on a horizontal line ignores the time delta entirely (time-independent by definition) and shifts only price", () => {
    const hLine = createHorizontalLine(150, 1000);
    const moved = applyDrag(hLine, "body", 9999, 25) as typeof hLine;
    assert.equal(moved.price, 175);
  });

  test("applyDrag never mutates its input object - returns a new object every time (this codebase's pure-function convention throughout lib/chart-engine)", () => {
    const line = createTrendLine({ time: 100, price: 100 }, { time: 900, price: 200 }, 1000);
    const original = { ...line, p1: { ...line.p1 }, p2: { ...line.p2 } };
    applyDrag(line, "p1", 999, 999);
    assert.deepEqual(line, original);
  });

  test("applyDrag on a Fibonacci Retracement's 'body' translates both anchors together, exactly like a trend line's body drag - its level lines are a pure derivation of p1/p2, never separately stored/dragged state", () => {
    const fib = createFibonacci({ time: 100, price: 100 }, { time: 900, price: 200 }, 1000);
    const moved = applyDrag(fib, "body", 50, 10) as typeof fib;
    assert.deepEqual(moved.p1, { time: 150, price: 110 });
    assert.deepEqual(moved.p2, { time: 950, price: 210 });
  });

  console.log("\n=== Object creation ===");

  test("createTrendLine/createHorizontalLine/createRectangle each produce a unique id - two objects created back to back never collide", () => {
    const a = createTrendLine({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
    const b = createTrendLine({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
    assert.notEqual(a.id, b.id);
  });

  test("every created object uses its tool's real default color, never an empty/undefined one", () => {
    const line = createTrendLine({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
    const hLine = createHorizontalLine(100, 1000);
    const rect = createRectangle({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
    const fib = createFibonacci({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
    assert.equal(line.color, DRAWING_TOOL_DEFAULT_COLOR.trendline);
    assert.equal(hLine.color, DRAWING_TOOL_DEFAULT_COLOR["horizontal-line"]);
    assert.equal(rect.color, DRAWING_TOOL_DEFAULT_COLOR.rectangle);
    assert.equal(fib.color, DRAWING_TOOL_DEFAULT_COLOR.fibonacci);
  });

  test("FIBONACCI_LEVELS is MT5's real OBJ_FIBO default ratio set (0%/23.6%/38.2%/50%/61.8%/78.6%/100%) - verified against mql5.com/metatrader5.com this session, never an invented level", () => {
    assert.deepEqual(FIBONACCI_LEVELS, [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
  });

  console.log("\n=== Persistence (store.ts - durable, DB-backed via /api/private/chart-drawings) ===");

  installFakeFetch();

  await testAsync("readDrawingObjects returns an empty array for a symbol/timeframe with nothing saved yet - never throws, never fabricates a default object", async () => {
    assert.deepEqual(await readDrawingObjects("EURUSD", "1h"), []);
  });

  await testAsync("write then read round-trips the exact objects for that symbol/timeframe", async () => {
    const objects: DrawingObject[] = [createTrendLine({ time: 0, price: 100 }, { time: 500, price: 150 }, 1000)];
    await writeDrawingObjects("XAUUSD", "4h", objects);
    assert.deepEqual(await readDrawingObjects("XAUUSD", "4h"), objects);
  });

  await testAsync("a Fibonacci Retracement round-trips through the store exactly like any other p1/p2 object - isValidDrawingObject() accepts the new tool", async () => {
    const objects: DrawingObject[] = [createFibonacci({ time: 0, price: 100 }, { time: 500, price: 150 }, 1000)];
    await writeDrawingObjects("GBPUSD", "1h", objects);
    assert.deepEqual(await readDrawingObjects("GBPUSD", "1h"), objects);
  });

  await testAsync("objects for one symbol/timeframe never leak into a different symbol or timeframe", async () => {
    await writeDrawingObjects("XAUUSD", "1h", [createHorizontalLine(200, 1000)]);
    await writeDrawingObjects("XAUUSD", "4h", [createHorizontalLine(999, 1000)]);
    const oneHour = await readDrawingObjects("XAUUSD", "1h");
    assert.equal(oneHour.length, 1);
    const [obj] = oneHour;
    assert.ok(obj.tool === "horizontal-line" && obj.price === 200);
  });

  await testAsync("a malformed/corrupted server response is silently dropped, never trusted as a half-formed object - client-side defense in depth, same discipline as the old sessionStorage read", async () => {
    const win = globalThis as unknown as { fetch: typeof fetch };
    const real = win.fetch;
    win.fetch = (async () =>
      new Response(JSON.stringify({ status: "ok", data: { objects: [{ tool: "trendline" }, { not: "an object" }, null] } }), { status: 200 })) as typeof fetch;
    try {
      assert.deepEqual(await readDrawingObjects("BADSYMBOL", "1h"), []);
    } finally {
      win.fetch = real;
    }
  });

  await testAsync("writeDrawingObjects for the SAME key is serialized in call order even when the network resolves out of order - a rapid add-then-delete never resurrects the deleted state", async () => {
    const win = globalThis as unknown as { fetch: typeof fetch };
    const real = win.fetch;
    const store = new Map<string, unknown>();
    const order: string[] = [];
    win.fetch = (async (input: string | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { symbol: string; timeframe: string; objects: unknown[] };
        // The SECOND write (the delete, an empty array) resolves FASTER than
        // the first (a slow network tick for the add) - without the write
        // queue in store.ts, this ordering alone would leave the add's
        // stale [A] persisted as the final DB value.
        const delayMs = body.objects.length > 0 ? 20 : 0;
        await new Promise((r) => setTimeout(r, delayMs));
        store.set(`${body.symbol}|${body.timeframe}`, body.objects);
        order.push(body.objects.length > 0 ? "add" : "delete");
      }
      return new Response(JSON.stringify({ status: "ok", data: {} }), { status: 200 });
    }) as typeof fetch;
    try {
      const line = createTrendLine({ time: 0, price: 0 }, { time: 1, price: 1 }, 1000);
      const addPromise = writeDrawingObjects("RACEUSD", "1h", [line]);
      const deletePromise = writeDrawingObjects("RACEUSD", "1h", []);
      await Promise.all([addPromise, deletePromise]);
      assert.deepEqual(order, ["add", "delete"], "the server must see the add BEFORE the delete, matching call order, not network resolution order");
      assert.deepEqual(store.get("RACEUSD|1h"), []);
    } finally {
      win.fetch = real;
    }
  });

  console.log("\n=== Rendering (drawing-renderer.ts) ===");

  test("drawDrawingObjects runs end-to-end for all four tool types without throwing, using only canvas methods the renderer already relies on elsewhere (never strokeRect)", () => {
    const objects: DrawingObject[] = [
      createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 1000),
      createHorizontalLine(160, 1000),
      createRectangle({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000),
      createFibonacci({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000),
    ];
    const ctx = fakeCtx();
    drawDrawingObjects(ctx, objects, CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PRICE_ROW, null);
    assert.ok(ctx.calls.includes("stroke"));
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  test("drawDrawingObjects draws one stroke per visible Fibonacci level (up to FIBONACCI_LEVELS.length), each with its own real ratio%/price label - never a single generic line standing in for all 7", () => {
    const fib = createFibonacci({ time: 200, price: 180 }, { time: 800, price: 120 }, 1000);
    const ctx = fakeCtx();
    drawDrawingObjects(ctx, [fib], CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PRICE_ROW, null);
    const strokeCount = ctx.calls.filter((c) => c === "stroke").length;
    const fillTextCount = ctx.calls.filter((c) => c === "fillText").length;
    assert.equal(strokeCount, FIBONACCI_LEVELS.length, "every level between p1/p2's price range should draw its own line here (both anchors are within VIEWPORT's 100-200 price range)");
    assert.equal(fillTextCount, FIBONACCI_LEVELS.length, "every drawn level should carry its own real ratio%/price label");
  });

  test("a selected object draws its handles (extra fillRect calls) that an unselected object doesn't", () => {
    const line = createTrendLine({ time: 100, price: 150 }, { time: 900, price: 150 }, 1000);
    const unselected = fakeCtx();
    drawDrawingObjects(unselected, [line], CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PRICE_ROW, null);
    const unselectedFillRects = unselected.calls.filter((c) => c === "fillRect").length;

    const selected = fakeCtx();
    drawDrawingObjects(selected, [line], CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PRICE_ROW, line.id);
    const selectedFillRects = selected.calls.filter((c) => c === "fillRect").length;

    assert.ok(selectedFillRects > unselectedFillRects);
  });

  test("a horizontal line whose price is outside the current viewport is never drawn - off-panel objects don't leak a stray line", () => {
    const hLine = createHorizontalLine(9999, 1000); // far outside VIEWPORT's 100-200 range
    const ctx = fakeCtx();
    drawDrawingObjects(ctx, [hLine], CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, PRICE_ROW, null);
    assert.ok(!ctx.calls.includes("moveTo"));
  });

  test("drawDrawingPreview runs without throwing for both 2-click tool types and uses a dashed line (setLineDash), visually distinct from a committed object", () => {
    const ctx = fakeCtx();
    drawDrawingPreview(ctx, { tool: "trendline", p1: { time: 100, price: 150 }, p2: { time: 800, price: 130 } }, CANDLES, INDEX_RANGE, VIEWPORT, "#f59e0b", PLOT_WIDTH, PRICE_ROW);
    assert.ok(ctx.calls.includes("setLineDash"));
    const ctx2 = fakeCtx();
    drawDrawingPreview(ctx2, { tool: "rectangle", p1: { time: 100, price: 150 }, p2: { time: 800, price: 130 } }, CANDLES, INDEX_RANGE, VIEWPORT, "#60a5fa", PLOT_WIDTH, PRICE_ROW);
    assert.ok(ctx2.calls.includes("setLineDash"));
  });

  console.log("\n=== renderChart() integration - zero regression when drawingObjects is omitted ===");

  test("renderChart with NO drawingObjects param produces the EXACT same call sequence as before this sprint - true byte-for-byte no-op for every existing caller", () => {
    const candles = makeCandles(30);
    const vp = fitToData(candles);
    const ctxWithout = fakeCtx();
    renderChart({ ctx: ctxWithout, dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 }, candles, viewport: vp, timeframe: "1h", crosshair: null, colors: resolveChartColors() });

    const ctxWithEmpty = fakeCtx();
    renderChart({
      ctx: ctxWithEmpty,
      dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport: vp,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
      drawingObjects: [],
      selectedDrawingObjectId: null,
      drawingPreview: null,
    });

    assert.deepEqual(ctxWithout.calls, ctxWithEmpty.calls);
  });

  test("renderChart WITH real drawingObjects runs end-to-end without throwing and draws more than the candles-only baseline", () => {
    const candles = makeCandles(30);
    const vp = fitToData(candles);
    const baseline = fakeCtx();
    renderChart({ ctx: baseline, dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 }, candles, viewport: vp, timeframe: "1h", crosshair: null, colors: resolveChartColors() });

    const withDrawings = fakeCtx();
    renderChart({
      ctx: withDrawings,
      dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport: vp,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
      drawingObjects: [createHorizontalLine((vp.minPrice + vp.maxPrice) / 2, 1000)],
    });

    assert.ok(withDrawings.calls.length > baseline.calls.length);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
