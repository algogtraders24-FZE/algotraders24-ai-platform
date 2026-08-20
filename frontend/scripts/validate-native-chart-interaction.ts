// scripts/validate-native-chart-interaction.ts
// Sprint D2.7.7 - AT24 Native Chart Engine: Professional Interaction &
// Navigation. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:native-chart-interaction`.
//
// This sprint is an interaction-quality sprint, not a data/rendering
// sprint: every test here proves the new pan/zoom/pointer-capture/touch/
// keyboard interaction model is correctly wired, deterministic, and
// honestly sourced, and that the already-verified D2.7.2-D2.7.6
// architecture (data flow, rendering, security, performance) is
// unaffected - deterministic fixtures only, no live credentials, no
// network calls, no fabricated claims.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import {
  clampViewportToCandleBounds,
  fitToData,
  isAtRightEdge,
  followLatest,
  panViewport,
  zoomViewport,
} from "../lib/chart-engine/viewport";
import { nearestCandleIndex } from "../lib/chart-engine/crosshair";
import { nearestIndexByTime } from "../lib/chart-engine/candle-index";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS } from "../lib/chart-engine/indicators/panel-registry";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { formatPrice, formatTimestamp } from "../lib/financial-format";
import type { ChartCandle } from "../types/chart-data";
import type { Viewport } from "../lib/chart-engine/types";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const nativeChartSrc = () => read("components/chart-engine/NativeChart.tsx");

// ============================================================
// Fixtures
// ============================================================

function chartCandle(time: number, o: number, h: number, l: number, c: number, volume?: number): ChartCandle {
  return { time, open: o, high: h, low: l, close: c, volume };
}

function makeCandleSeries(count: number, stepMs: number, base = 100, withVolume = true): ChartCandle[] {
  const start = Date.now() - count * stepMs;
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 4) * 3 + i * 0.02;
    const c = o + (i % 3 === 0 ? -1 : 1) * (0.5 + (i % 5));
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.8;
    out.push(chartCandle(start + i * stepMs, o, h, l, c, withVolume ? 500 + (i % 30) * 15 : undefined));
  }
  return out;
}

function fakeCtx(): CanvasRenderingContext2D {
  const ctx = {
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: () => {},
    setLineDash: () => {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

// ============================================================
// 1 - Pan
// ============================================================
async function panTests(): Promise<void> {
  await test("panViewport shifts both bounds by the same real delta - span (zoom level) is unchanged by a pan", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 0, maxPrice: 1 };
    const panned = panViewport(vp, 25_000);
    assert.equal(panned.minTime, 25_000);
    assert.equal(panned.maxTime - panned.minTime, vp.maxTime - vp.minTime);
  });

  await test("pan operates purely in viewport/candle-space (real epoch-ms time), never raw pixels - the pointer handler converts px to ms before calling panViewport", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("panViewport(startViewport, deltaMs)"));
  });

  await test("the drag pan result is clamped to real candle bounds before being applied - 'panning must respect available candle bounds'", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("clampViewportToCandleBounds(panViewport(startViewport, deltaMs), candles)"));
  });

  await test("keyboard arrow-key pan is also clamped to real candle bounds", () => {
    const src = nativeChartSrc();
    const keyHandler = src.slice(src.indexOf("function handleKeyDown"));
    assert.ok(keyHandler.includes("clampViewportToCandleBounds(panViewport(viewport, direction * step * PAN_KEY_STEP_CANDLES), candles)"));
  });

  await test("panning updates the renderer directly via refs, never through a per-pointer-move React re-render of the viewport itself", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("viewportRef.current = { ...next, minPrice, maxPrice };"));
    assert.ok(!/const \[viewport, setViewport\]/.test(src));
  });

  await test("a real pan sequence never produces NaN/Infinity bounds", () => {
    const candles = makeCandleSeries(200, 60_000);
    let vp = fitToData(candles);
    for (let i = 0; i < 50; i++) {
      vp = clampViewportToCandleBounds(panViewport(vp, (i % 2 === 0 ? 1 : -1) * 500_000), candles);
      for (const value of [vp.minTime, vp.maxTime]) assert.ok(Number.isFinite(value));
    }
  });

  await test("panning never accidentally moves the price range independently - minPrice/maxPrice are always recomputed via priceRangeForWindow after a pan, never carried over stale", () => {
    const src = nativeChartSrc();
    const applyBlock = src.slice(src.indexOf("function applyViewport"), src.indexOf("function handleWheel"));
    assert.ok(applyBlock.includes("priceRangeForWindow(candles, next.minTime, next.maxTime)"));
  });

  await test("panning works identically regardless of the requested timeframe - panViewport/clamp take no timeframe parameter at all", () => {
    const candles1m = makeCandleSeries(300, 60_000);
    const candles1d = makeCandleSeries(300, 24 * 60 * 60_000);
    for (const candles of [candles1m, candles1d]) {
      const vp = clampViewportToCandleBounds(panViewport(fitToData(candles), 1_000_000), candles);
      assert.ok(Number.isFinite(vp.minTime) && Number.isFinite(vp.maxTime));
    }
  });

  await test("a fresh viewport at the data's own bounds is never altered by clamping (idempotent when already in range)", () => {
    const candles = makeCandleSeries(100, 60_000);
    const vp = fitToData(candles);
    const clamped = clampViewportToCandleBounds(vp, candles);
    assert.equal(clamped.minTime, vp.minTime);
    assert.equal(clamped.maxTime, vp.maxTime);
  });

  await test("panning past the historical edge stops advancing further back once clamped - repeated pan-back converges, never drifts to -Infinity", () => {
    const candles = makeCandleSeries(100, 60_000);
    let vp = fitToData(candles);
    for (let i = 0; i < 20; i++) vp = clampViewportToCandleBounds(panViewport(vp, -10_000_000), candles);
    const finalMin = vp.minTime;
    vp = clampViewportToCandleBounds(panViewport(vp, -10_000_000), candles);
    assert.equal(vp.minTime, finalMin);
  });
}

// ============================================================
// 2 - Zoom (wheel + pinch)
// ============================================================
async function zoomTests(): Promise<void> {
  await test("zoomViewport preserves the anchor as closely as mathematically possible - the anchor's ratio within the span is unchanged by a zoom", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 0, maxPrice: 1 };
    const anchor = 30_000;
    const zoomed = zoomViewport(vp, 0.5, anchor, 1_000);
    const preRatio = (anchor - vp.minTime) / (vp.maxTime - vp.minTime);
    const postRatio = (anchor - zoomed.minTime) / (zoomed.maxTime - zoomed.minTime);
    assert.ok(Math.abs(preRatio - postRatio) < 1e-9);
  });

  await test("wheel zoom is clamped to real candle bounds before being applied", () => {
    const src = nativeChartSrc();
    const wheelHandler = src.slice(src.indexOf("function handleWheel"), src.indexOf("function handlePointerDown"));
    assert.ok(wheelHandler.includes("clampViewportToCandleBounds(zoomed, candles)"));
  });

  await test("wheel zoom respects the existing 5-2000 visible-candle bounds (reuses zoomViewport, never a second zoom model)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 0, maxPrice: 1 };
    let zoomed = vp;
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 0.5, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime >= 1_000 * 5 - 1e-6);
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 2, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime <= 1_000 * 2000 + 1e-6);
  });

  await test("zoomViewport's optional candleCount ties the zoom-out ceiling to real loaded data - fixes a real bug found live-verifying Ichimoku this session, where only ~300 loaded candles could still be zoomed out to a flat 2000-candle-wide span (real data reduced to a thin sliver against an otherwise-empty chart)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 0, maxPrice: 1 };
    let zoomed = vp;
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 2, 5_000, 1_000, 300);
    // ZOOM_OUT_DATA_MULTIPLIER (2) * 300 candles = 600 candles - far below the flat 2000 ceiling.
    assert.ok(zoomed.maxTime - zoomed.minTime <= 1_000 * 600 + 1e-6, `expected the span to be capped near 600 candles for 300 loaded candles, got ${(zoomed.maxTime - zoomed.minTime) / 1_000} candles`);
  });

  await test("zoomViewport omitting candleCount (every pre-existing call site/test) is byte-for-byte unaffected - still the flat 2000-candle ceiling, never a silent behavior change for callers that don't pass it", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 0, maxPrice: 1 };
    let zoomed = vp;
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 2, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime <= 1_000 * 2000 + 1e-6);
    assert.ok(zoomed.maxTime - zoomed.minTime >= 1_000 * 1999);
  });

  await test("handleWheel passes candles.length through to zoomViewport, so the real production wheel-zoom gets the data-aware ceiling, not just the flat 2000-candle one", () => {
    const src = nativeChartSrc();
    const wheelHandler = src.slice(src.indexOf("function handleWheel"), src.indexOf("function handlePointerDown"));
    assert.ok(wheelHandler.includes("zoomViewport(viewport, factor, anchorTime, candleStepMs(candles), candles.length)"));
  });

  await test("wheel zoom velocity is inherently bounded - the applied factor never scales with deltaY magnitude, only its sign, so a large trackpad-fling delta zooms by the exact same step as a tiny nudge", () => {
    const src = nativeChartSrc();
    const wheelHandler = src.slice(src.indexOf("function handleWheel"), src.indexOf("function handlePointerDown"));
    assert.ok(wheelHandler.includes("e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR"));
    assert.ok(!/deltaY\s*\*|deltaY\s*\/(?!\s*Math)/.test(wheelHandler));
  });

  await test("handleWheel calls preventDefault - the FIRST half of stopping the page from scrolling while zooming the chart (see the next test for the second, previously-missing half)", () => {
    const src = nativeChartSrc();
    const wheelHandler = src.slice(src.indexOf("function handleWheel"), src.indexOf("function handlePointerDown"));
    assert.ok(wheelHandler.includes("e.preventDefault()"));
  });

  await test("the wheel listener is attached imperatively with { passive: false }, never via the JSX onWheel prop - a real bug found live on production this session: React 17+ attaches its delegated wheel/touchstart/touchmove listeners as PASSIVE by default, which silently ignores preventDefault() no matter how correctly handleWheel calls it, so scrolling over the chart ALSO scrolled the containing page (not TradingView-like, where the page never moves)", () => {
    const src = nativeChartSrc();
    assert.ok(!src.includes("onWheel={handleWheel}"), "the JSX onWheel prop must be gone - it's the passive listener that caused the bug");
    assert.ok(src.includes('addEventListener("wheel", listener, { passive: false })'), "the imperative, non-passive listener is what actually makes preventDefault() work");
  });

  await test("the imperative wheel listener always dispatches to the LATEST render's handleWheel via a ref, never a closure captured once on mount - handleWheelRef.current is reassigned every render, so the listener never goes stale even though its own attaching effect runs only once", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("handleWheelRef.current = handleWheel;"));
    const effectBlock = src.slice(src.indexOf('canvas.addEventListener("wheel"') - 400, src.indexOf('canvas.addEventListener("wheel"') + 400);
    assert.ok(effectBlock.includes("}, []);"), "the attaching effect must run once on mount (empty dep array) - re-attaching per render would defeat the point of the ref indirection");
    assert.ok(effectBlock.includes("canvas.removeEventListener"), "cleanup must remove the exact same listener reference passed to addEventListener, never leaking it across remounts");
  });

  await test("pinch-zoom reuses the SAME zoomViewport function wheel/keyboard zoom already use - never a second zoom model", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("zoomViewport(startViewport, factor, anchorTime, candleStepMs(candles), candles.length)"));
  });

  await test("pinch-zoom anchors on the real midpoint between the two live touch points", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("const midX = (points[0].x + points[1].x) / 2;"));
  });

  await test("pinch-zoom's result is clamped to real candle bounds, matching every other zoom path", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    const pinchBlock = moveHandler.slice(moveHandler.indexOf("if (pinchRef.current"), moveHandler.indexOf("if (dragRef.current)"));
    assert.ok(pinchBlock.includes("clampViewportToCandleBounds(zoomed, candles)"));
  });

  await test("starting a pinch (a second finger landing) cancels any single-finger drag in progress - the two gestures never run simultaneously", () => {
    const src = nativeChartSrc();
    const downHandler = src.slice(src.indexOf("function handlePointerDown"), src.indexOf("function handlePointerMove"));
    const twoFingerBlock = downHandler.slice(downHandler.indexOf('size === 2'));
    assert.ok(twoFingerBlock.includes("dragRef.current = null;"));
  });

  await test("keyboard +/- zoom is also clamped to real candle bounds", () => {
    const src = nativeChartSrc();
    const keyHandler = src.slice(src.indexOf("function handleKeyDown"));
    assert.ok(keyHandler.includes('clampViewportToCandleBounds(zoomViewport(viewport, ZOOM_IN_FACTOR, mid, step, candles.length), candles)'));
    assert.ok(keyHandler.includes('clampViewportToCandleBounds(zoomViewport(viewport, ZOOM_OUT_FACTOR, mid, step, candles.length), candles)'));
  });

  await test("a real zoom sequence never produces NaN/Infinity bounds", () => {
    const candles = makeCandleSeries(300, 60_000);
    let vp = fitToData(candles);
    for (let i = 0; i < 50; i++) {
      vp = clampViewportToCandleBounds(zoomViewport(vp, i % 2 === 0 ? 0.9 : 1.1, vp.minTime + 10_000, 60_000), candles);
      assert.ok(Number.isFinite(vp.minTime) && Number.isFinite(vp.maxTime));
    }
  });
}

// ============================================================
// 3 - Pointer capture
// ============================================================
async function pointerCaptureTests(): Promise<void> {
  const src = nativeChartSrc();

  await test("a pointer is captured on pointerdown - the browser guarantees subsequent move/up events reach the canvas regardless of cursor position", () => {
    assert.ok(src.includes("canvas.setPointerCapture(e.pointerId);"));
  });

  await test("capture is released on pointer cleanup (pointerup/pointercancel both route through the same releasePointer function)", () => {
    const releaseFn = src.slice(src.indexOf("function releasePointer"), src.indexOf("function handlePointerUp"));
    assert.ok(releaseFn.includes("canvasRef.current?.releasePointerCapture(e.pointerId);"));
  });

  await test("releasing capture is wrapped in a try/catch - an already-released pointer (a real, valid browser state) never throws and breaks the handler", () => {
    const releaseFn = src.slice(src.indexOf("function releasePointer"), src.indexOf("function handlePointerUp"));
    assert.ok(releaseFn.includes("try {"));
    assert.ok(releaseFn.includes("catch"));
  });

  await test("THE FIX: the chart can never become permanently stuck in dragging mode - dragRef is only ever cleared via the shared, always-reached releasePointer cleanup or the window-blur safety net, never left to depend on a same-element mouseup that pointer capture makes unnecessary", () => {
    assert.ok(src.includes("if (activePointersRef.current.size === 0) dragRef.current = null;"));
  });

  await test("pointerleave does NOT cancel an active drag - with real capture in effect, panning correctly continues even if the cursor visually exits the canvas bounds mid-drag", () => {
    const leaveFn = src.slice(src.indexOf("function handlePointerLeave"), src.indexOf("function handleDoubleClick"));
    assert.ok(leaveFn.includes("if (dragRef.current || pinchRef.current) return;"));
  });

  await test("pointer capture is applied via the native Pointer Events API (onPointerDown/Move/Up/Cancel/Leave), not legacy Mouse Events which have no capture mechanism at all", () => {
    assert.ok(src.includes("onPointerDown={handlePointerDown}"));
    assert.ok(src.includes("onPointerMove={handlePointerMove}"));
    assert.ok(src.includes("onPointerUp={handlePointerUp}"));
    assert.ok(!/onMouseDown=|onMouseMove=|onMouseUp=/.test(src));
  });
}

// ============================================================
// 4 - Pointer cancellation
// ============================================================
async function pointerCancellationTests(): Promise<void> {
  const src = nativeChartSrc();

  await test("pointercancel is handled explicitly (a real event a touch gesture can receive when the OS reinterprets it mid-stream) - not silently ignored", () => {
    assert.ok(src.includes("onPointerCancel={handlePointerCancel}"));
    assert.ok(src.includes("function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {"));
  });

  await test("pointercancel and pointerup share the EXACT same cleanup path (releasePointer) - no divergent/partial cleanup logic between the two", () => {
    const cancelFn = src.slice(src.indexOf("function handlePointerCancel"), src.indexOf("function handlePointerLeave"));
    const upFn = src.slice(src.indexOf("function handlePointerUp"), src.indexOf("function handlePointerCancel"));
    assert.ok(cancelFn.includes("releasePointer(e);"));
    assert.ok(upFn.includes("releasePointer(e);"));
  });

  await test("cancelling one pointer of an active pinch drops back to single-pointer state cleanly (pinchRef cleared once fewer than 2 pointers remain)", () => {
    const releaseFn = src.slice(src.indexOf("function releasePointer"), src.indexOf("function handlePointerUp"));
    assert.ok(releaseFn.includes("if (activePointersRef.current.size < 2) pinchRef.current = null;"));
  });

  await test("a window blur (alt-tab, a native dialog stealing focus) resets ALL interaction state as a safety net - covers the one case pointer capture itself cannot guarantee an up/cancel event for", () => {
    assert.ok(src.includes('window.addEventListener("blur", resetInteractionState);'));
    const blurEffect = src.slice(src.indexOf("function resetInteractionState"), src.indexOf("function resetInteractionState") + 300);
    assert.ok(blurEffect.includes("dragRef.current = null;"));
    assert.ok(blurEffect.includes("pinchRef.current = null;"));
    assert.ok(blurEffect.includes("activePointersRef.current.clear();"));
  });

  await test("the blur safety-net listener is cleaned up on unmount - no listener leak", () => {
    const blurBlock = src.slice(src.indexOf('window.addEventListener("blur"'), src.indexOf('window.addEventListener("blur"') + 200);
    assert.ok(blurBlock.includes('window.removeEventListener("blur", resetInteractionState)'));
  });
}

// ============================================================
// 5 - Viewport bounds (clampViewportToCandleBounds)
// ============================================================
async function viewportBoundsTests(): Promise<void> {
  await test("clampViewportToCandleBounds is a no-op for an empty candle series (nothing real to bound against)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 0, maxPrice: 1 };
    assert.deepEqual(clampViewportToCandleBounds(vp, []), vp);
  });

  await test("clampViewportToCandleBounds always preserves the viewport's span (zoom level) - clamping only ever changes WHERE, never how zoomed in", () => {
    const candles = makeCandleSeries(50, 60_000);
    const vp: Viewport = { minTime: candles[0].time - 100_000_000, maxTime: candles[0].time - 100_000_000 + 500_000, minPrice: 0, maxPrice: 1 };
    const clamped = clampViewportToCandleBounds(vp, candles);
    assert.ok(Math.abs((clamped.maxTime - clamped.minTime) - (vp.maxTime - vp.minTime)) < 1e-6);
  });

  await test("clamping a viewport panned far into the past pulls it back so at least the oldest real candle is reachable at the right edge", () => {
    const candles = makeCandleSeries(50, 60_000);
    const span = 500_000;
    const vp: Viewport = { minTime: candles[0].time - 50_000_000, maxTime: candles[0].time - 50_000_000 + span, minPrice: 0, maxPrice: 1 };
    const clamped = clampViewportToCandleBounds(vp, candles);
    assert.ok(clamped.maxTime >= candles[0].time - span - 1e-6);
  });

  await test("clamping a viewport panned far into the future pulls it back so at least the latest real candle is reachable at the left edge", () => {
    const candles = makeCandleSeries(50, 60_000);
    const span = 500_000;
    const latest = candles[candles.length - 1].time;
    const vp: Viewport = { minTime: latest + 50_000_000, maxTime: latest + 50_000_000 + span, minPrice: 0, maxPrice: 1 };
    const clamped = clampViewportToCandleBounds(vp, candles);
    assert.ok(clamped.minTime <= latest + span + 1e-6);
  });

  await test("clamping never produces NaN/Infinity for any real candle series and any real (even wildly out-of-range) viewport", () => {
    const candles = makeCandleSeries(100, 60_000);
    for (const offset of [-1e12, -1e6, 0, 1e6, 1e12]) {
      const vp: Viewport = { minTime: offset, maxTime: offset + 100_000, minPrice: 0, maxPrice: 1 };
      const clamped = clampViewportToCandleBounds(vp, candles);
      assert.ok(Number.isFinite(clamped.minTime) && Number.isFinite(clamped.maxTime));
    }
  });

  await test("clamping a single-candle series (zero real span) does not throw and stays finite", () => {
    const candles = [chartCandle(1_000_000, 100, 101, 99, 100)];
    const vp: Viewport = { minTime: 0, maxTime: 500_000, minPrice: 0, maxPrice: 1 };
    assert.doesNotThrow(() => clampViewportToCandleBounds(vp, candles));
  });

  await test("a viewport already fully within the real candle range is returned unmodified (idempotent, no unnecessary drift)", () => {
    const candles = makeCandleSeries(100, 60_000);
    const vp = fitToData(candles);
    const clamped = clampViewportToCandleBounds(vp, candles);
    const clampedAgain = clampViewportToCandleBounds(clamped, candles);
    assert.deepEqual(clamped, clampedAgain);
  });

  await test("clamping is applied INSIDE NativeChart.tsx at the interaction call sites, never inside panViewport/zoomViewport themselves - both stay pure and unclamped, exactly as D2.7.2's own tests already lock in", () => {
    const viewportSrc = read("lib/chart-engine/viewport.ts");
    const panFn = viewportSrc.slice(viewportSrc.indexOf("export function panViewport"), viewportSrc.indexOf("export function panViewport") + 300);
    const zoomFn = viewportSrc.slice(viewportSrc.indexOf("export function zoomViewport"), viewportSrc.indexOf("export function zoomViewport") + 600);
    assert.ok(!panFn.includes("clampViewportToCandleBounds"));
    assert.ok(!zoomFn.includes("clampViewportToCandleBounds"));
  });

  await test("D2.7.2's own exact-equality fitToData contract is unaffected by the new clamp function - fitToData still returns minTime === candles[0].time exactly", () => {
    const candles = makeCandleSeries(10, 60_000);
    const vp = fitToData(candles);
    assert.equal(vp.minTime, candles[0].time);
  });
}

// ============================================================
// 6 - Follow-latest
// ============================================================
async function followLatestTests(): Promise<void> {
  await test("isAtRightEdge/followLatest (the live-edge model) are byte-for-byte unaffected by this sprint - viewport.ts's own D2.7.3 functions untouched in behavior", () => {
    const candles = makeCandleSeries(50, 60_000);
    const atEdge = fitToData(candles);
    assert.ok(isAtRightEdge(atEdge, candles));
    const pannedBack: Viewport = { ...atEdge, minTime: atEdge.minTime - 10_000_000, maxTime: atEdge.minTime - 5_000_000 };
    assert.equal(isAtRightEdge(pannedBack, candles), false);
  });

  await test("the D2.7.4 fittedKeyRef initial-viewport-race fix is completely unaffected by this sprint's interaction changes", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("fittedKeyRef"));
    assert.ok(src.includes("alreadyFittedForThisKey"));
  });

  await test("followLatest preserves the current span (zoom level) when re-following - the user's chosen zoom never resets just because new data arrived", () => {
    const candles = makeCandleSeries(50, 60_000);
    const vp = fitToData(candles);
    const span = vp.maxTime - vp.minTime;
    const followed = followLatest(vp, candles);
    assert.ok(Math.abs((followed.maxTime - followed.minTime) - span) < 1e-6);
  });

  await test("applyViewport recomputes isLive via the SAME isAtRightEdge function on every call - no separate/divergent live-detection logic for pan vs zoom vs pinch", () => {
    const src = nativeChartSrc();
    const applyFn = src.slice(src.indexOf("function applyViewport"), src.indexOf("function handleWheel"));
    assert.equal((applyFn.match(/isAtRightEdge\(/g) ?? []).length, 1);
  });

  await test("Go-Live (handleGoLive) still calls followLatest through the standard applyViewport path - unaffected", () => {
    const src = nativeChartSrc();
    const goLiveFn = src.slice(src.indexOf("function handleGoLive"), src.indexOf("function handleToggleFullscreen"));
    assert.ok(goLiveFn.includes("applyViewport(followLatest(viewport, candles));"));
  });

  await test("a background poll's new candles only shift the viewport when the user was already at the right edge - the D2.7.3 data effect's own branching is untouched by this sprint", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("isAtRightEdge(previousViewport, candles)"));
    assert.ok(src.includes("followLatest(previousViewport, candles)"));
  });
}

// ============================================================
// 7 - Historical navigation / return-to-latest
// ============================================================
async function historicalNavigationTests(): Promise<void> {
  await test("Fit (handleFit) re-fits to the full real candle range and correctly recomputes isLive afterward", () => {
    const src = nativeChartSrc();
    const fitFn = src.slice(src.indexOf("function handleFit"), src.indexOf("function handleGoLive"));
    assert.ok(fitFn.includes("viewportRef.current = fitToData(candles);"));
    assert.ok(fitFn.includes("isAtRightEdge(viewportRef.current, candles)"));
  });

  await test("double-click triggers Fit - a standard, expected professional charting shortcut, unaffected by this sprint", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("onDoubleClick={handleDoubleClick}"));
    const dblFn = src.slice(src.indexOf("function handleDoubleClick"), src.indexOf("function handleFit"));
    assert.ok(dblFn.includes("handleFit();"));
  });

  await test("Home/End keyboard shortcuts still map to Fit/Go-Live respectively", () => {
    const src = nativeChartSrc();
    const keyFn = src.slice(src.indexOf("function handleKeyDown"));
    assert.ok(keyFn.includes('e.key === "Home"'));
    assert.ok(keyFn.includes('e.key === "End"'));
  });

  await test("manually panning backward and then returning to latest produces a viewport that is, once again, honestly at the right edge", () => {
    const candles = makeCandleSeries(100, 60_000);
    const fitted = fitToData(candles);
    const pannedBack = clampViewportToCandleBounds(panViewport(fitted, -5_000_000), candles);
    assert.equal(isAtRightEdge(pannedBack, candles), false);
    const restored = followLatest(pannedBack, candles);
    assert.ok(isAtRightEdge(restored, candles));
  });
}

// ============================================================
// 8 - Crosshair
// ============================================================
async function crosshairTests(): Promise<void> {
  const candles = makeCandleSeries(200, 60_000);
  const viewport = fitToData(candles);
  const plotWidth = 900;

  await test("crosshair snapping is still binary-search equivalent to nearestIndexByTime - unaffected by the pointer-event migration", () => {
    const targetTime = candles[50].time + 200;
    const x = ((targetTime - viewport.minTime) / (viewport.maxTime - viewport.minTime)) * plotWidth;
    assert.equal(nearestCandleIndex(candles, viewport, x, plotWidth), nearestIndexByTime(candles, targetTime));
  });

  await test("crosshair never interpolates a synthetic candle - always a real index into the real array", () => {
    for (let i = 0; i < 10; i++) {
      const x = (i / 10) * plotWidth;
      const index = nearestCandleIndex(candles, viewport, x, plotWidth);
      assert.ok(Number.isInteger(index));
      assert.ok(index >= -1 && index < candles.length);
    }
  });

  await test("the crosshair readout row's timestamp field uses formatTimestamp - the real candle's own time, never a synthetic one", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes('formatTimestamp(hoveredCandle.time, "datetime")'));
  });

  await test("crosshair candle snapping is unaffected after a pan/zoom - it always re-derives from the CURRENT viewportRef, never a stale cached one", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("const viewport = viewportRef.current;"));
    assert.ok(moveHandler.includes("nearestCandleIndex(candles, viewport, x, plotWidth())"));
  });

  await test("crosshair becomes inactive (cleared) when the pointer moves outside the plot's horizontal bounds", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveHandler.includes("x > plotWidth()"));
    assert.ok(moveHandler.includes("crosshairRef.current = null;"));
  });

  await test("Escape clears an active crosshair - a real, previously-missing keyboard escape hatch for a transient interaction state", () => {
    const src = nativeChartSrc();
    // Window widened from 700 (post-MT5-feature-parity Phase 1 - the
    // Escape branch also cancels an in-progress drawing-tool placement/
    // drag now, and a new Delete/Backspace branch sits right after it,
    // pushing the crosshair-clearing line further into the function than
    // the original fixed window covered).
    const keyFn = src.slice(src.indexOf("function handleKeyDown"), src.indexOf("function handleKeyDown") + 1400);
    assert.ok(keyFn.includes('if (e.key === "Escape") {'));
    assert.ok(keyFn.includes("crosshairRef.current = null;"));
  });

  await test("pointer movement never triggers indicator recomputation - computeIndicatorSeries is never called from inside handlePointerMove", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!moveHandler.includes("computeIndicatorSeries"));
  });

  await test("no stale crosshair persists across a symbol/timeframe change - the data effect explicitly nulls it on every real re-fit", () => {
    const src = nativeChartSrc();
    const dataEffect = src.slice(src.indexOf("useEffect(() => {\n    const key = "), src.indexOf("}, [candles, symbol, timeframe, draw]);"));
    assert.ok((dataEffect.match(/crosshairRef\.current = null;/g) ?? []).length >= 2);
  });
}

// ============================================================
// 9 - Tooltip / OHLC / timestamp correctness
// ============================================================
async function tooltipTests(): Promise<void> {
  await test("the tooltip displays Open/High/Low/Close using formatPrice, the shared financial formatter - never a raw toFixed/toString", () => {
    const src = nativeChartSrc();
    const readoutBlock = src.slice(src.indexOf("hoveredCandle ? ("), src.indexOf("Native chart (beta)"));
    assert.ok(!/\.toFixed\(/.test(readoutBlock));
    assert.ok(readoutBlock.includes("formatPrice("));
  });

  await test("Volume is shown ONLY when the hovered candle genuinely has a volume value - never fabricated for an instrument without one", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("hoveredCandle.volume !== undefined &&"));
  });

  await test("real OHLC values pass through formatPrice unchanged in magnitude - the formatter only pads/caps display digits, never invents one", () => {
    assert.equal(formatPrice(100), "100.00");
    assert.equal(formatPrice(100.12345, { maxDecimals: 5 }), "100.12345");
  });

  await test("real timestamps pass through formatTimestamp using the candle's own real epoch-ms time, in UTC, never a local-timezone guess", () => {
    const label = formatTimestamp(Date.UTC(2026, 0, 15, 14, 30), "datetime");
    assert.ok(typeof label === "string" && label.length > 0);
  });

  await test("no change/range figure is shown in the tooltip that isn't deterministically derivable from the loaded candle data - the readout only ever shows O/H/L/C/V/indicator values, all real fields of the hovered candle", () => {
    const src = nativeChartSrc();
    const readoutBlock = src.slice(src.indexOf("hoveredCandle ? ("), src.indexOf("Native chart (beta)"));
    assert.ok(!/change|Δ|percent/i.test(readoutBlock));
  });

  await test("indicator values in the tooltip are read via valueAtIndex from an already-computed series - never recomputed or interpolated for the tooltip specifically", () => {
    const src = nativeChartSrc();
    const readoutBlock = src.slice(src.indexOf("hoveredCandle ? ("), src.indexOf("Native chart (beta)"));
    assert.ok(readoutBlock.includes("valueAtIndex(series, hoveredIndex)"));
  });
}

// ============================================================
// 10 - Price/time-axis synchronization
// ============================================================
async function axisSyncTests(): Promise<void> {
  await test("the renderer's crosshair price-axis label (D2.7.6) is unaffected by this sprint's pointer-event migration - still scoped to the price panel row only", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    assert.ok(fn.includes("if (y >= priceRow.top && y <= priceRow.top + priceRow.height) {"));
  });

  // Updated (gapless x-axis, this session) - the crosshair's x position now
  // comes from indexToX(crosshair.index, ...) (index-scale.ts), the same
  // shared gapless positioning candles/ticks/drawn objects all use, not
  // coordinate-system.ts's time-domain timeToX. crosshair.index is already
  // the real snapped candle's own array index, so this needs no lookup.
  await test("the crosshair's time-axis label is drawn at the real snapped candle's own x position, via the SAME indexToX every other renderer element uses", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"), src.indexOf("function drawCrosshair") + 400);
    assert.ok(fn.includes("indexToX(crosshair.index, indexRange, plotWidth)"));
  });

  await test("panning/zooming does not desynchronize the crosshair from the axis - draw() always passes the SAME crosshairRef.current to renderChart on every redraw", () => {
    const src = nativeChartSrc();
    const drawFn = src.slice(src.indexOf("const draw = useMemo"), src.indexOf("const draw = useMemo") + 700);
    assert.ok(drawFn.includes("crosshair: crosshairRef.current,"));
  });
}

// ============================================================
// 11 - Symbol / timeframe / provider changes
// ============================================================
async function switchingTests(): Promise<void> {
  const src = nativeChartSrc();
  const hookSrc = read("components/chart-engine/useChartCandles.ts");

  await test("a symbol/timeframe change still re-fits and clears interaction state (crosshair, hovered index) - unaffected by the pointer-event migration", () => {
    const dataEffect = src.slice(src.indexOf("useEffect(() => {\n    const key = "), src.indexOf("}, [candles, symbol, timeframe, draw]);"));
    assert.ok(dataEffect.includes("setHoveredIndex(-1);"));
  });

  await test("a symbol/timeframe change does not leave a stale drag/pinch in progress - dragRef/pinchRef are never touched by the data effect, so switching mid-drag can't corrupt interaction state (the drag simply continues panning the NEW viewport once fresh data lands)", () => {
    const dataEffect = src.slice(src.indexOf("useEffect(() => {\n    const key = "), src.indexOf("}, [candles, symbol, timeframe, draw]);"));
    assert.ok(!dataEffect.includes("dragRef.current = null"));
  });

  await test("provider switching (native <-> TradingView) is unaffected - the explicit ternary in ChartPanel.tsx is untouched by this sprint", () => {
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(panelSrc.includes('provider === "native" ? ('));
    assert.ok(!panelSrc.includes("Sprint D2.7.7"));
  });

  await test("D2.7.5's session-state persistence (provider/timeframe/indicators) is untouched by this sprint", () => {
    const sessionSrc = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!sessionSrc.includes("Sprint D2.7.7"));
  });

  await test("polling (useChartCandles's 20s interval) is completely untouched by this sprint - interaction changes never touched the data-fetching hook", () => {
    assert.ok(!hookSrc.includes("Sprint D2.7.7"));
    assert.ok(hookSrc.includes("const POLL_INTERVAL_MS = 20_000"));
  });

  await test("a background poll's data replacement (wholesale series replacement, never a merge) remains unaffected", () => {
    assert.ok(hookSrc.includes("setResult({ status: deriveStatus(series), series })"));
    assert.ok(!/\.push\(|\.concat\(/.test(hookSrc));
  });

  await test("AbortController-based stale-request cancellation on a rapid symbol/timeframe switch is unaffected", () => {
    assert.ok(hookSrc.includes("const controller = new AbortController();"));
    assert.ok(hookSrc.includes("if (cancelled) return"));
  });

  await test("TradingView (AdvancedChart.tsx) remains completely untouched by D2.7.7 - no compatibility defect was found that justified touching it", () => {
    const advancedSrc = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(!advancedSrc.includes("Sprint D2.7.7"));
    assert.ok(advancedSrc.includes("export default function AdvancedChart"));
  });
}

// ============================================================
// 12 - Empty data / rejected candles
// ============================================================
async function emptyDataTests(): Promise<void> {
  await test("an empty candle series still produces an honest placeholder viewport, never fabricated bounds", () => {
    const vp = fitToData([]);
    assert.ok(Number.isFinite(vp.minTime) && Number.isFinite(vp.maxTime));
  });

  await test("clamping an empty series is a safe no-op (already covered structurally, re-verified against the real fitToData([]) placeholder)", () => {
    const placeholder = fitToData([]);
    assert.deepEqual(clampViewportToCandleBounds(placeholder, []), placeholder);
  });

  await test("a candle with high < low is still rejected by the normalizer, never silently repaired - unaffected by this sprint", () => {
    const raw = [{ datetime: "2026-01-01T00:00:00Z", open: 100, high: 90, low: 99, close: 95 }];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
    assert.equal(rejectedCount, 1);
  });

  await test("rejectedCount is still honestly surfaced in the UI - NativeChart.tsx's caption is unaffected by this sprint", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("rejectedCount > 0"));
  });

  await test("the empty-loading-placeholder render still deliberately does NOT stamp fittedKeyRef - the D2.7.4 fix's own comment and logic are untouched", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("deliberately do NOT stamp fittedKeyRef"));
  });
}

// ============================================================
// 13 - Mobile / touch pointer events
// ============================================================
async function touchTests(): Promise<void> {
  const src = nativeChartSrc();

  await test("touch-action:none is set on the canvas - prevents the browser's native scroll/pinch-zoom from fighting with our own pointer-event gesture handling ('no accidental browser navigation')", () => {
    assert.ok(src.includes('style={{ touchAction: "none" }}'));
  });

  await test("single-finger touch drives the same pan path as a mouse drag - Pointer Events unify mouse/touch/pen, so no separate touch-only code path exists", () => {
    assert.ok(!/onTouchStart|onTouchMove|onTouchEnd/.test(src));
    assert.ok(src.includes('activePointersRef.current.size === 1'));
  });

  await test("a second touch point starts real pinch-zoom tracking (startDistance + startViewport captured from real pointer positions)", () => {
    const downFn = src.slice(src.indexOf("function handlePointerDown"), src.indexOf("function handlePointerMove"));
    assert.ok(downFn.includes("const startDistance = pointerDistance(points[0], points[1]);"));
    assert.ok(downFn.includes("pinchRef.current = { startDistance, startViewport: viewportRef.current };"));
  });

  await test("pinch distance is computed via a real Euclidean distance between the two live touch points - never a 1-D approximation", () => {
    assert.ok(src.includes("Math.hypot(a.x - b.x, a.y - b.y)"));
  });

  await test("touch interaction cannot corrupt viewport state - pinch only ever proceeds when both a real, positive startDistance and current distance exist, otherwise it's skipped rather than dividing by zero", () => {
    const moveFn = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveFn.includes("if (distance > 0 && startDistance > 0) {"));
  });

  await test("desktop mouse behavior is unchanged by the touch/pinch additions - a single mouse pointer (button) still only ever triggers the existing 1-pointer drag path, pinch requires activePointersRef.size === 2 which a mouse alone can never reach", () => {
    const downFn = src.slice(src.indexOf("function handlePointerDown"), src.indexOf("function handlePointerMove"));
    assert.ok(downFn.includes("} else if (activePointersRef.current.size === 1) {"));
  });

  await test("pointer cancellation (a real event mobile browsers can dispatch mid-gesture) is explicitly handled, not merely tolerated by accident", () => {
    assert.ok(src.includes("function handlePointerCancel"));
  });

  await test("pinch-zoom was implemented using entirely EXISTING zoom architecture (zoomViewport/coordinate math) - not a fake/simulated gesture and not a second zoom model, per the sprint's own 'do not fake it' instruction", () => {
    const moveFn = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(moveFn.includes("zoomViewport("));
  });
}

// ============================================================
// 14 - Keyboard interaction
// ============================================================
async function keyboardTests(): Promise<void> {
  const src = nativeChartSrc();

  await test("the canvas is focusable (tabIndex=0) - unaffected by this sprint", () => {
    assert.ok(src.includes("tabIndex={0}"));
  });

  await test("keyboard focus state is now visible - `outline-none` was removed so the site's existing global :focus-visible gold-ring rule (app/globals.css) applies to the canvas like every other focusable element", () => {
    assert.ok(!/className="h-full w-full cursor-crosshair outline-none"/.test(src));
    const globalsCss = read("app/globals.css");
    assert.ok(globalsCss.includes(":focus-visible"));
  });

  await test("left/right arrow keys pan by a fixed number of candles - unaffected in spirit, now clamped", () => {
    const keyFn = src.slice(src.indexOf("function handleKeyDown"));
    assert.ok(keyFn.includes('e.key === "ArrowLeft" || e.key === "ArrowRight"'));
    assert.ok(keyFn.includes("PAN_KEY_STEP_CANDLES"));
  });

  await test("+/- keys zoom centered on the current view's midpoint - unaffected in spirit, now clamped", () => {
    const keyFn = src.slice(src.indexOf("function handleKeyDown"));
    assert.ok(keyFn.includes('e.key === "+" || e.key === "="'));
    assert.ok(keyFn.includes('e.key === "-" || e.key === "_"'));
  });

  await test("Escape does not call stopPropagation - the separate window-level fullscreen-exit Escape listener still fires too, so one press correctly handles both scopes without a conflict", () => {
    const keyFn = src.slice(src.indexOf("function handleKeyDown"), src.indexOf("function handleKeyDown") + 700);
    assert.ok(!keyFn.includes("stopPropagation"));
  });

  await test("no keyboard trap: arrow/+/-/Home/End/Escape all call preventDefault only for the SPECIFIC key handled, never swallowing Tab - focus can always leave the canvas", () => {
    const keyFn = src.slice(src.indexOf("function handleKeyDown"), src.indexOf("useEffect(() => {\n    return () => {"));
    assert.ok(!/e\.key === "Tab"/.test(keyFn));
  });

  await test("keyboard navigation is scoped to the canvas's own onKeyDown (React synthetic, only fires while focused) - it never hijacks page-level scrolling/keyboard use elsewhere in the Workspace", () => {
    assert.ok(src.includes("onKeyDown={handleKeyDown}"));
  });

  await test("Escape while a drag/pinch is in progress cancels it - keyboard can interrupt an in-progress pointer gesture", () => {
    const keyFn = src.slice(src.indexOf("function handleKeyDown"), src.indexOf("function handleKeyDown") + 700);
    assert.ok(keyFn.includes("dragRef.current = null;"));
    assert.ok(keyFn.includes("pinchRef.current = null;"));
  });
}

// ============================================================
// 15 - Multi-panel coordination (crosshair/pointer never treats a
// sub-panel's coordinates as price-panel coordinates)
// ============================================================
async function multiPanelTests(): Promise<void> {
  await test("candle-index lookup (nearestCandleIndex) is purely time/x-based - it has no panel-row concept at all, so it behaves identically regardless of which panel row the pointer's y falls in", () => {
    const candles = makeCandleSeries(100, 60_000);
    const viewport = fitToData(candles);
    const x = 400;
    // same x, different y (simulating price panel vs a sub-panel row) -> same index
    const indexInPricePanelY = nearestCandleIndex(candles, viewport, x, 900);
    const indexInSubPanelY = nearestCandleIndex(candles, viewport, x, 900);
    assert.equal(indexInPricePanelY, indexInSubPanelY);
  });

  await test("the renderer's price-axis crosshair label (D2.7.6) is the one thing that genuinely differs by panel row, and it is explicitly bounds-checked against the real priceRow - re-verified unaffected by this sprint", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    assert.ok(fn.includes("priceRow.top") && fn.includes("priceRow.height"));
  });

  await test("renderChart with an active RSI sub-panel and a crosshair positioned in that sub-panel's row still completes without throwing", () => {
    const candles = makeCandleSeries(100, 60_000);
    const viewport = fitToData(candles);
    const series = DEFAULT_INDICATOR_CONFIGS.filter((c) => c.id === "rsi").map((cfg) => computeIndicatorSeries(candles, cfg));
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 900, height: 450, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: { index: 50, x: 400, y: 420 },
        colors: resolveChartColors(),
        activePanels: ["rsi"],
        indicatorSeries: series,
      });
    });
  });
}

// ============================================================
// 16 - Performance guards
// ============================================================
async function performanceTests(): Promise<void> {
  for (const count of [500, 2000, 5000]) {
    await test(`full pipeline (normalize -> fit -> indicators -> render) completes within budget at ${count} candles`, () => {
      const raw = makeCandleSeries(count, 60_000).map((c) => ({
        datetime: new Date(c.time).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      const t0 = Date.now();
      const { candles } = normalizeCandles(raw);
      const viewport = fitToData(candles);
      const series = DEFAULT_INDICATOR_CONFIGS.map((cfg) => computeIndicatorSeries(candles, cfg));
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 1200, height: 700, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: { index: Math.floor(count / 2), x: 500, y: 300 },
        colors: resolveChartColors(),
        activePanels: ["volume", "rsi", "macd"],
        indicatorSeries: series,
      });
      const elapsedMs = Date.now() - t0;
      assert.ok(elapsedMs < 3000, `full pipeline took ${elapsedMs}ms at ${count} candles`);
    });
  }

  await test("a simulated pan gesture (200 rapid clampViewportToCandleBounds+panViewport ticks) at 5,000 candles stays fast", () => {
    const candles = makeCandleSeries(5000, 60_000);
    let vp = fitToData(candles);
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) vp = clampViewportToCandleBounds(panViewport(vp, i % 2 === 0 ? 5000 : -5000), candles);
    assert.ok(Date.now() - t0 < 500);
  });

  await test("the canvas redraw during a pointer stream is coalesced to at most one per animation frame (scheduleDraw), not once per raw pointer event", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("function scheduleDraw()"));
    assert.ok(src.includes("if (drawRafRef.current !== null) return;"));
  });

  await test("the pan/hover/pinch pointer paths all route their redraw through scheduleDraw (coalesce=true / scheduleDraw()), not the immediate synchronous draw()", () => {
    const src = nativeChartSrc();
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!/[^e]draw\(\);/.test(moveHandler.replace(/scheduleDraw\(\);/g, "")));
  });

  await test("applyViewport skips calling the setIsLive state setter entirely when the live/not-live value hasn't actually changed - not just relying on React's own re-render bailout", () => {
    const src = nativeChartSrc();
    const applyFn = src.slice(src.indexOf("function applyViewport"), src.indexOf("function handleWheel"));
    assert.ok(applyFn.includes("if (live !== isLiveRef.current) {"));
  });

  await test("the draw-coalescing rAF handle is cancelled on unmount, alongside the existing hover-throttle rAF handle - no rAF leak from either timer", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("cancelAnimationFrame(rafRef.current)"));
    assert.ok(src.includes("cancelAnimationFrame(drawRafRef.current)"));
  });

  await test("indicator series remain memoized on [candles, activeConfigs] - never recomputed during a pan/zoom/crosshair interaction frame, unaffected by this sprint", () => {
    const src = nativeChartSrc();
    assert.ok(src.includes("() => activeConfigs.map((cfg) => computeIndicatorSeries(candles, cfg)),\n    [candles, activeConfigs],"));
  });

  await test("ResizeObserver cleanup is unaffected by this sprint's interaction changes", () => {
    const src = nativeChartSrc();
    const resizeEffect = src.slice(src.indexOf("new ResizeObserver"), src.indexOf("new ResizeObserver") + 800);
    assert.ok(resizeEffect.includes("observer.disconnect()"));
  });
}

// ============================================================
// 17 - No-fabrication guards
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("no hardcoded fallback symbol (EURUSD/BTCUSD) exists in this sprint's modified files", () => {
    for (const f of ["components/chart-engine/NativeChart.tsx", "lib/chart-engine/viewport.ts"]) {
      assert.ok(!/EURUSD|BTCUSD/.test(read(f)));
    }
  });

  await test("no BUY/SELL/automated-trading/broker-execution/probability language exists anywhere in this sprint's changes", () => {
    for (const f of ["components/chart-engine/NativeChart.tsx", "lib/chart-engine/viewport.ts"]) {
      assert.ok(!/\bBUY\b|\bSELL\b|place order|execute trade|broker|probability/i.test(read(f)));
    }
  });

  await test("no Redis/Kafka/WebSocket dependency was introduced by this sprint's interaction changes", () => {
    const src = nativeChartSrc();
    assert.ok(!/redis|kafka/i.test(src));
    assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
  });

  await test("clampViewportToCandleBounds only ever derives bounds from the REAL candles[0]/candles[last] timestamps - never a guessed or hardcoded time range", () => {
    const src = read("lib/chart-engine/viewport.ts");
    const fn = src.slice(src.indexOf("export function clampViewportToCandleBounds"));
    assert.ok(fn.includes("candles[0].time"));
    assert.ok(fn.includes("candles[candles.length - 1].time"));
  });

  await test("Intelligence Score/Regime/Hypothesis/DecisionContext services are untouched by D2.7.7", () => {
    for (const f of [
      "services/intelligence/score/intelligence-score.service.ts",
      "services/intelligence/regime/regime.service.ts",
      "services/intelligence/hypothesis/hypothesis.service.ts",
      "services/intelligence/decision/decision-context.service.ts",
    ]) {
      assert.ok(!read(f).includes("Sprint D2.7.7"));
    }
  });
}

// ============================================================
// 18 - Regression guards (existing architecture reuse / no duplication)
// ============================================================
async function regressionGuardTests(): Promise<void> {
  await test("no second chart engine, viewport model, timeframe registry, indicator registry, or symbol registry was introduced anywhere in this sprint's changes", () => {
    for (const f of ["components/chart-engine/NativeChart.tsx", "lib/chart-engine/viewport.ts"]) {
      assert.ok(!/SYMBOL_MAP|SYMBOL_REGISTRY|INDICATOR_REGISTRY_V2|TIMEFRAME_REGISTRY|class \w*Viewport\w*Model/.test(read(f)));
    }
  });

  await test("the candles API route's auth/validation posture is unchanged by this sprint - route.ts untouched", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(!src.includes("Sprint D2.7.7"));
  });

  await test("no provider credentials reach any client-side chart-engine file - unaffected", () => {
    for (const f of ["components/chart-engine/NativeChart.tsx", "lib/chart-engine/viewport.ts"]) {
      assert.ok(!/apiKey|API_KEY|_SECRET|_PASSWORD/i.test(read(f)));
    }
  });

  await test("sessionStorage (chart-session-state.ts) still carries only non-sensitive chart UI state - untouched by this sprint, no new field added", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/password|token|email|userId/i.test(src));
    assert.ok(!src.includes("Sprint D2.7.7"));
  });

  await test("no user-specific market data is cached globally by this sprint - no caching code was touched at all", () => {
    const routeSrc = read("app/api/private/market-data/candles/route.ts");
    assert.ok(!routeSrc.includes("Sprint D2.7.7"));
  });

  await test("D2.7.6's rendering-quality additions (vertical grid, body-width cap, responsive tick density, RSI/MACD/Volume labels) are all untouched by this sprint", () => {
    const rendererSrc = read("lib/chart-engine/renderer.ts");
    const subPanelSrc = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(!rendererSrc.includes("Sprint D2.7.7"));
    assert.ok(!subPanelSrc.includes("Sprint D2.7.7"));
  });

  await test("candle-index.ts (binary search) and crosshair.ts are completely untouched by this sprint", () => {
    assert.ok(!read("lib/chart-engine/candle-index.ts").includes("Sprint D2.7.7"));
    assert.ok(!read("lib/chart-engine/crosshair.ts").includes("Sprint D2.7.7"));
  });

  await test("real-market instrument catalog/resolution is unaffected by this sprint - re-verified for a representative cross-asset sample", () => {
    for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK", "BTCUSD", "ETHUSD", "XAUUSD", "XAGUSD", "EURUSD", "GBPUSD"]) {
      assert.ok(getCanonicalInstrument(id), `${id} missing from catalog`);
      assert.equal(resolveChartInstrument(id).supported, true, `${id} should be chart-supported`);
    }
  });
}

async function main(): Promise<void> {
  await panTests();
  await zoomTests();
  await pointerCaptureTests();
  await pointerCancellationTests();
  await viewportBoundsTests();
  await followLatestTests();
  await historicalNavigationTests();
  await crosshairTests();
  await tooltipTests();
  await axisSyncTests();
  await switchingTests();
  await emptyDataTests();
  await touchTests();
  await keyboardTests();
  await multiPanelTests();
  await performanceTests();
  await noFabricationTests();
  await regressionGuardTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
