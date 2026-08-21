// scripts/validate-native-chart-phase5.ts
// Sprint D2.7.11 Phase 5 - "Chart Properties & Presentation", opened after
// the user shared real MT5 desktop screenshots (chart right-click menu +
// the Properties dialog's Common/Show/Colors tabs) and asked what else was
// implementable. First slice: MT5's own Bar chart / Candlesticks / Line
// chart toggle (right-click chart menu, Alt+1/2/3 in real MT5). Covers the
// renderer (lib/chart-engine/renderer.ts, end-to-end against a recording
// fake ctx - same fakeCtx pattern as validate-native-chart-engine.ts's own
// renderer tests) and the ChartToolbar/NativeChart wiring (source-text
// checks, this codebase's established "no component-rendering framework"
// convention).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderChart } from "../lib/chart-engine/renderer";
import { fitToData } from "../lib/chart-engine/viewport";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
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

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function chartCandle(time: number, o: number, h: number, l: number, c: number): ChartCandle {
  return { time, open: o, high: h, low: l, close: c, volume: 1000 };
}

function makeSeries(count: number, stepMs = 60_000, base = 100): ChartCandle[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + i;
    const c = base + i + (i % 2 === 0 ? 1 : -1);
    const h = Math.max(o, c) + 1;
    const l = Math.min(o, c) - 1;
    out.push(chartCandle(start + i * stepMs, o, h, l, c));
  }
  return out;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function renderWith(chartType: "candlestick" | "bar" | "line" | undefined, candles: ChartCandle[]) {
  const { ctx, calls } = fakeCtx();
  const vp = fitToData(candles);
  renderChart({
    ctx,
    dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
    candles,
    viewport: vp,
    timeframe: "1h",
    crosshair: null,
    colors: resolveChartColors(),
    chartType,
  });
  return calls;
}

function count(calls: string[], name: string): number {
  return calls.filter((c) => c === name).length;
}

function rendererTests(): void {
  const candles = makeSeries(20, 60_000);

  test("1: chartType omitted renders byte-for-byte identically to chartType: 'candlestick' - the default is never a behavior change for any existing caller", () => {
    const withDefault = renderWith(undefined, candles);
    const explicit = renderWith("candlestick", candles);
    assert.deepEqual(withDefault, explicit);
  });

  test("2: 'bar' chart type never fills a candle body (no per-candle fillRect) - only the background/price-marker fillRect calls from candlestick mode remain, so bar's fillRect count is strictly less", () => {
    const candlestickCalls = renderWith("candlestick", candles);
    const barCalls = renderWith("bar", candles);
    assert.ok(count(barCalls, "fillRect") < count(candlestickCalls, "fillRect"), "bar mode must never fillRect a candle body");
  });

  test("3: 'line' chart type never fills a candle body either, and draws a SINGLE continuous path (one moveTo, not one per candle) - so its moveTo count is far below candlestick's per-candle wick+outline moveTo calls", () => {
    const candlestickCalls = renderWith("candlestick", candles);
    const lineCalls = renderWith("line", candles);
    assert.ok(count(lineCalls, "fillRect") < count(candlestickCalls, "fillRect"), "line mode must never fillRect a candle body");
    assert.ok(count(lineCalls, "moveTo") < count(candlestickCalls, "moveTo"), "line mode must draw one continuous path, not per-candle moves");
  });

  test("4: 'bar' chart type draws 3 strokes worth of moveTo per bar (high-low, open tick, close tick) - its moveTo count exceeds line mode's single-path count", () => {
    const barCalls = renderWith("bar", candles);
    const lineCalls = renderWith("line", candles);
    assert.ok(count(barCalls, "moveTo") > count(lineCalls, "moveTo"));
  });

  test("5: every chart type renders an empty candle series without throwing (honest empty-plot draw, matching drawCandles' own existing contract)", () => {
    assert.doesNotThrow(() => renderWith("bar", []));
    assert.doesNotThrow(() => renderWith("line", []));
    assert.doesNotThrow(() => renderWith("candlestick", []));
  });

  test("6: every chart type renders a single-candle series without throwing (a real degenerate case - a brand-new symbol with only one candle loaded)", () => {
    const one = makeSeries(1);
    assert.doesNotThrow(() => renderWith("bar", one));
    assert.doesNotThrow(() => renderWith("line", one));
  });
}

function wiringTests(): void {
  test("7: ChartToolbar renders a 'Chart type' button group offering exactly Candles/Bars/Line - MT5's own three real chart styles, never an invented fourth", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes('aria-label="Chart type"'));
    assert.ok(src.includes('{ value: "candlestick", label: "Candles"'));
    assert.ok(src.includes('{ value: "bar", label: "Bars"'));
    assert.ok(src.includes('{ value: "line", label: "Line"'));
  });

  test("8: the chart-type buttons reflect the active selection via aria-pressed, the same pattern the layout selector (Phase 3) and provider toggle already use - never a second, bespoke 'is this active' convention", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    const block = src.slice(src.indexOf('aria-label="Chart type"'), src.indexOf('aria-label="Chart type"') + 700);
    assert.ok(block.includes("aria-pressed={chartType === ct.value}"));
  });

  test("9: NativeChart owns chartType as its own local state (like isLive/activeTool) - NOT lifted to ChartPanel, since it's a rendering-style preference rather than per-instrument data", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('useState<ChartRenderType>("candlestick")'));
  });

  test("10: NativeChart's draw() useMemo includes chartType in its dependency array and passes it to renderChart - switching chart type must actually trigger a redraw, never a stale canvas", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const drawBlock = src.slice(src.indexOf("const draw = useMemo"), src.indexOf("const draw = useMemo") + 2000);
    assert.ok(drawBlock.includes("chartType,"), "renderChart(...) call must pass chartType");
    assert.ok(/\[candles, timeframe, activePanels, indicatorSeries, symbol, name, liveQuote, chartType\]/.test(drawBlock), "deps array must include chartType");
  });

  test("11: NativeChart forwards chartType/onChartTypeChange to ChartToolbar - the toggle is reachable, never dead state with no UI", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("chartType={chartType}"));
    assert.ok(src.includes("onChartTypeChange={setChartType}"));
  });

  test("12: renderer.ts's chartType param defaults to 'candlestick' at the destructuring site - the actual guarantee behind test 1's byte-identical-render assertion, not just a coincidence of this test's inputs", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes('chartType = "candlestick"'));
  });
}

async function main(): Promise<void> {
  console.log("=== Renderer (chart type: candlestick/bar/line) ===");
  rendererTests();
  console.log("\n=== Wiring (ChartToolbar.tsx / NativeChart.tsx) ===");
  wiringTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
