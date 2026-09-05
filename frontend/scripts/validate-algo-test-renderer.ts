// scripts/validate-algo-test-renderer.ts
// P3.2B - the pure canvas rendering for Algo Test trade markers
// (renderer.ts's drawAlgoTestTrades/algoTradePx), following the exact
// same recordingCtx() fake-canvas convention validate-paper-trading-
// chart-lines.ts already established. `ctx.fill()` and `ctx.arc()` are
// used ONLY by this new code path in the entire renderChart() pipeline
// (verified by source grep before relying on this) - a clean, low-
// fragility signal for "an entry-marker triangle was drawn" / "a
// selected-trade highlight ring was drawn", independent of however many
// candle/grid/axis fillRect/stroke calls also happen in the same frame.
import assert from "node:assert/strict";
import { renderChart, type AlgoTestTradeMarker } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { fitToData } from "../lib/chart-engine/viewport";
import { fractionalIndexForTime, indexRangeForViewport, indexToX } from "../lib/chart-engine/index-scale";
import { priceToY } from "../lib/chart-engine/coordinate-system";
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

function makeCandleSeries(count: number, stepMs: number, base = 4000): ChartCandle[] {
  const start = Date.now() - count * stepMs;
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 4) * 3;
    const c = o + (i % 3 === 0 ? -1 : 1) * 0.5;
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.8;
    out.push({ time: start + i * stepMs, open: o, high: h, low: l, close: c, volume: 500 });
  }
  return out;
}

interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ArcCall {
  x: number;
  y: number;
  radius: number;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; fillRects: RectCall[]; fillCalls: number; arcCalls: ArcCall[]; strokeStyles: string[] } {
  const fillRects: RectCall[] = [];
  const arcCalls: ArcCall[] = [];
  const strokeStyles: string[] = [];
  let fillCalls = 0;
  const ctx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRects.push({ x, y, w, h });
    },
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {
      fillCalls += 1;
    },
    arc: (x: number, y: number, radius: number) => {
      arcCalls.push({ x, y, radius });
    },
    fillText: () => {},
    setLineDash: () => {},
    set fillStyle(_v: string) {},
    set strokeStyle(v: string) {
      strokeStyles.push(v);
    },
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillRects, get fillCalls() { return fillCalls; }, arcCalls, strokeStyles };
}

const CANDLE_COUNT = 60;
const STEP_MS = 5 * 60_000; // M5

function renderWith(candles: ChartCandle[], overrides: Partial<Parameters<typeof renderChart>[0]>) {
  const viewport = fitToData(candles);
  const rec = recordingCtx();
  const dims = { width: 900, height: 400, priceAxisWidth: 60, timeAxisHeight: 24 };
  renderChart({ ctx: rec.ctx, dims, candles, viewport, timeframe: "5m", colors: resolveChartColors("mt5"), ...overrides });
  return { ...rec, viewport, dims };
}

function expectedPx(time: number, price: number, candles: ChartCandle[], viewport: ReturnType<typeof fitToData>, plotWidth: number, priceRowHeight: number) {
  const range = indexRangeForViewport(candles, viewport);
  const index = fractionalIndexForTime(candles, time);
  return { x: indexToX(index, range, plotWidth), y: priceToY(price, viewport, priceRowHeight) };
}

function main(): void {
  const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
  const midCandle = candles[Math.floor(CANDLE_COUNT / 2)]!;
  const laterCandle = candles[Math.floor(CANDLE_COUNT / 2) + 5]!;

  const buyTrade: AlgoTestTradeMarker = {
    tradeId: "t1",
    side: "BUY",
    entryTime: midCandle.time,
    entryPrice: midCandle.close,
    exitTime: laterCandle.time,
    exitPrice: laterCandle.close + 5,
  };
  const sellTrade: AlgoTestTradeMarker = {
    tradeId: "t2",
    side: "SELL",
    entryTime: midCandle.time,
    entryPrice: midCandle.close - 2,
    exitTime: laterCandle.time,
    exitPrice: laterCandle.close - 7,
  };

  console.log("=== Trade Visualization: trade -> entry marker -> exit marker ===");

  test("algoTestTrades defaults to empty - zero fill()/arc() calls (byte-for-byte unchanged for every existing caller)", () => {
    const { fillCalls, arcCalls } = renderWith(candles, {});
    assert.equal(fillCalls, 0);
    assert.equal(arcCalls.length, 0);
  });

  test("one trade draws exactly one entry-marker triangle (one fill() call)", () => {
    const { fillCalls } = renderWith(candles, { algoTestTrades: [buyTrade] });
    assert.equal(fillCalls, 1);
  });

  test("two trades whose entries land far apart draw exactly two entry-marker triangles (D2.9.4 - clustering only activates when entries land within TRADE_CLUSTER_BUCKET_PX of each other; buyTrade/sellTrade share the same entryTime deliberately for the OTHER tests in this file, so this test uses its own well-separated pair)", () => {
    const farCandle = candles[CANDLE_COUNT - 5]!;
    const spreadSellTrade: AlgoTestTradeMarker = { ...sellTrade, entryTime: farCandle.time, entryPrice: farCandle.close - 2 };
    const { fillCalls } = renderWith(candles, { algoTestTrades: [buyTrade, spreadSellTrade] });
    assert.equal(fillCalls, 2);
  });

  test("a BUY trade's line/marker color is colors.buyLine; a SELL trade's is colors.sellLine", () => {
    const colors = resolveChartColors("mt5");
    const { strokeStyles: buyStrokes } = renderWith(candles, { algoTestTrades: [buyTrade] });
    assert.ok(buyStrokes.includes(colors.buyLine), "BUY trade must use buyLine color");
    assert.ok(!buyStrokes.includes(colors.sellLine), "a lone BUY trade must never introduce sellLine");

    const { strokeStyles: sellStrokes } = renderWith(candles, { algoTestTrades: [sellTrade] });
    assert.ok(sellStrokes.includes(colors.sellLine), "SELL trade must use sellLine color");
  });

  test("the exit marker is drawn at exactly the trade's own (exitTime, exitPrice) pixel position - the same math a trade-list row's own jump-to-trade relies on", () => {
    const { fillRects, dims, viewport } = renderWith(candles, { algoTestTrades: [buyTrade] });
    const plotWidth = dims.width - dims.priceAxisWidth;
    const priceRowHeight = dims.height - dims.timeAxisHeight;
    const expected = expectedPx(buyTrade.exitTime, buyTrade.exitPrice, candles, viewport, plotWidth, priceRowHeight);
    // Exit marker: fillRect(exit.x - radius, exit.y - radius, radius*2, radius*2), radius=4 (unselected).
    const match = fillRects.find((r) => Math.abs(r.x + 4 - expected.x) < 0.5 && Math.abs(r.y + 4 - expected.y) < 0.5 && r.w === 8 && r.h === 8);
    assert.ok(match, `expected an 8x8 exit-marker fillRect centered at (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}), got: ${JSON.stringify(fillRects)}`);
  });

  test("selecting a trade draws a highlight ring (arc) around its entry marker; an unselected trade draws none", () => {
    const { arcCalls: unselected } = renderWith(candles, { algoTestTrades: [buyTrade], selectedAlgoTestTradeId: null });
    assert.equal(unselected.length, 0);

    const { arcCalls: selected } = renderWith(candles, { algoTestTrades: [buyTrade], selectedAlgoTestTradeId: buyTrade.tradeId });
    assert.equal(selected.length, 1);
  });

  test("selecting one trade among several only rings THAT trade (one arc call, not N)", () => {
    const { arcCalls } = renderWith(candles, { algoTestTrades: [buyTrade, sellTrade], selectedAlgoTestTradeId: sellTrade.tradeId });
    assert.equal(arcCalls.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
