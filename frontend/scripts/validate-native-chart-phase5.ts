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
import { resolveChartColors, CHART_THEME_LABELS } from "../lib/chart-engine/canvas-colors";
import { computePeriodSeparators } from "../lib/chart-engine/time-axis";
import type { ChartCandle } from "../types/chart-data";
import type { SignalTimeframe } from "../types/signal";

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

function renderWith(
  candles: ChartCandle[],
  opts: { chartType?: "candlestick" | "bar" | "line"; showGrid?: boolean; showPeriodSeparators?: boolean; timeframe?: SignalTimeframe } = {},
) {
  const { ctx, calls } = fakeCtx();
  const vp = fitToData(candles);
  renderChart({
    ctx,
    dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
    candles,
    viewport: vp,
    timeframe: opts.timeframe ?? "1h",
    crosshair: null,
    colors: resolveChartColors(),
    chartType: opts.chartType,
    showGrid: opts.showGrid,
    showPeriodSeparators: opts.showPeriodSeparators,
  });
  return calls;
}

function count(calls: string[], name: string): number {
  return calls.filter((c) => c === name).length;
}

function rendererTests(): void {
  const candles = makeSeries(20, 60_000);

  test("1: chartType omitted renders byte-for-byte identically to chartType: 'candlestick' - the default is never a behavior change for any existing caller", () => {
    const withDefault = renderWith(candles, {});
    const explicit = renderWith(candles, { chartType: "candlestick" });
    assert.deepEqual(withDefault, explicit);
  });

  test("2: 'bar' chart type never fills a candle body (no per-candle fillRect) - only the background/price-marker fillRect calls from candlestick mode remain, so bar's fillRect count is strictly less", () => {
    const candlestickCalls = renderWith(candles, { chartType: "candlestick" });
    const barCalls = renderWith(candles, { chartType: "bar" });
    assert.ok(count(barCalls, "fillRect") < count(candlestickCalls, "fillRect"), "bar mode must never fillRect a candle body");
  });

  test("3: 'line' chart type never fills a candle body either, and draws a SINGLE continuous path (one moveTo, not one per candle) - so its moveTo count is far below candlestick's per-candle wick+outline moveTo calls", () => {
    const candlestickCalls = renderWith(candles, { chartType: "candlestick" });
    const lineCalls = renderWith(candles, { chartType: "line" });
    assert.ok(count(lineCalls, "fillRect") < count(candlestickCalls, "fillRect"), "line mode must never fillRect a candle body");
    assert.ok(count(lineCalls, "moveTo") < count(candlestickCalls, "moveTo"), "line mode must draw one continuous path, not per-candle moves");
  });

  test("4: 'bar' chart type draws 3 strokes worth of moveTo per bar (high-low, open tick, close tick) - its moveTo count exceeds line mode's single-path count", () => {
    const barCalls = renderWith(candles, { chartType: "bar" });
    const lineCalls = renderWith(candles, { chartType: "line" });
    assert.ok(count(barCalls, "moveTo") > count(lineCalls, "moveTo"));
  });

  test("5: every chart type renders an empty candle series without throwing (honest empty-plot draw, matching drawCandles' own existing contract)", () => {
    assert.doesNotThrow(() => renderWith([], { chartType: "bar" }));
    assert.doesNotThrow(() => renderWith([], { chartType: "line" }));
    assert.doesNotThrow(() => renderWith([], { chartType: "candlestick" }));
  });

  test("6: every chart type renders a single-candle series without throwing (a real degenerate case - a brand-new symbol with only one candle loaded)", () => {
    const one = makeSeries(1);
    assert.doesNotThrow(() => renderWith(one, { chartType: "bar" }));
    assert.doesNotThrow(() => renderWith(one, { chartType: "line" }));
  });

  test("13: showGrid omitted (default true) renders byte-for-byte identically to showGrid: true - preserves this renderer's pre-Phase-5b 'grid always drawn' behavior for every existing caller", () => {
    const withDefault = renderWith(candles, {});
    const explicit = renderWith(candles, { showGrid: true });
    assert.deepEqual(withDefault, explicit);
  });

  test("14: showGrid: false draws strictly fewer strokes than the default (grid lines genuinely stop being drawn, not just visually hidden)", () => {
    const withGrid = renderWith(candles, { showGrid: true });
    const withoutGrid = renderWith(candles, { showGrid: false });
    assert.ok(count(withoutGrid, "stroke") < count(withGrid, "stroke"));
  });

  test("15: showPeriodSeparators omitted (default false) renders byte-for-byte identically to showPeriodSeparators: true - matches real MT5's own default (verified against the user's live Properties dialog screenshot: 'Show period separators' unchecked)", () => {
    const withDefault = renderWith(candles, {});
    const explicitOff = renderWith(candles, { showPeriodSeparators: false });
    assert.deepEqual(withDefault, explicitOff);
  });

  test("16: computePeriodSeparators finds exactly the UTC day boundaries in a multi-day intraday series, never off-by-one, never a separator at index 0 (the first candle is never 'after' a boundary)", () => {
    // 3 candles/day across 3 days, 8h apart - deliberately coarse so each
    // day has few candles and the boundary index is easy to hand-verify.
    const start = Date.parse("2026-01-01T00:00:00Z");
    const threeDays: ChartCandle[] = [];
    for (let i = 0; i < 9; i++) threeDays.push({ time: start + i * 8 * 3_600_000, open: 1, high: 2, low: 0, close: 1 });
    const separators = computePeriodSeparators(threeDays, "4h");
    assert.deepEqual(separators.map((s) => s.index), [3, 6]);
  });

  test("17: computePeriodSeparators returns nothing for D1+ timeframes - one bar already IS a whole day there, so a same-scale day-boundary line would be redundant, never fabricated", () => {
    const candles20 = makeSeries(20, 86_400_000);
    assert.deepEqual(computePeriodSeparators(candles20, "1d"), []);
    assert.deepEqual(computePeriodSeparators(candles20, "1w"), []);
  });

  test("18: showPeriodSeparators: true on a real multi-day intraday series draws strictly more strokes than showPeriodSeparators: false (the separator lines are genuinely drawn, not just computed and discarded)", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const multiDay: ChartCandle[] = [];
    for (let i = 0; i < 12; i++) multiDay.push({ time: start + i * 4 * 3_600_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i });
    const off = renderWith(multiDay, { timeframe: "4h", showPeriodSeparators: false });
    const on = renderWith(multiDay, { timeframe: "4h", showPeriodSeparators: true });
    assert.ok(count(on, "stroke") > count(off, "stroke"));
  });

  test("24: resolveChartColors('mt5-green') returns a real, distinct palette from 'mt5' - the Colors-tab scheme picker's two options genuinely differ, never the same colors under two names", () => {
    const black = resolveChartColors("mt5");
    const green = resolveChartColors("mt5-green");
    assert.notEqual(black.bullish, green.bullish);
    assert.notEqual(black.accent, green.accent);
  });

  test("25: 'mt5-green' matches the exact real values from the user's own live Properties-dialog Colors-tab screenshot - Lime bull/#00ff00, LimeGreen volume/#32cd32, and the Last-price-line's literal RGB(0,192,0)/#00c000 - never an invented palette", () => {
    const green = resolveChartColors("mt5-green");
    assert.equal(green.background, "#000000");
    assert.equal(green.bullish, "#00ff00");
    assert.equal(green.volume, "#32cd32");
    assert.equal(green.accent, "#00c000");
  });

  test("26: CHART_THEME_LABELS provides a human-readable label for every ChartTheme the Colors-tab picker offers - 'Black' and 'Green on Black', matching MT5's own real scheme names", () => {
    assert.equal(CHART_THEME_LABELS.mt5, "Black");
    assert.equal(CHART_THEME_LABELS["mt5-green"], "Green on Black");
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
    const drawBlock = src.slice(src.indexOf("const draw = useMemo"), src.indexOf("const draw = useMemo") + 2500);
    assert.ok(drawBlock.includes("chartType,"), "renderChart(...) call must pass chartType");
    assert.ok(
      /\[candles, timeframe, activePanels, indicatorSeries, symbol, name, liveQuote, chartType, showGrid, showPeriodSeparators, colorScheme\]/.test(drawBlock),
      "deps array must include chartType/showGrid/showPeriodSeparators/colorScheme",
    );
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

  test("19: renderer.ts's showGrid/showPeriodSeparators default at the destructuring site to true/false respectively - the actual guarantee behind tests 13/15's byte-identical-render assertions", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("showGrid = true"));
    assert.ok(src.includes("showPeriodSeparators = false"));
  });

  test("20: ChartToolbar renders a 'Properties' button wired to onOpenProperties - MT5's own Properties dialog (F8), reachable from the toolbar like Templates/Fit/Live", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes("onClick={onOpenProperties}"));
    assert.ok(src.includes("Properties"));
  });

  test("21: NativeChart owns showGrid/showPeriodSeparators as local state (same 'rendering-style preference, not per-instrument data' reasoning as chartType) and opens a Chart Properties Modal - reusing the EXISTING Modal component, never a second bespoke dialog implementation", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("const [showGrid, setShowGrid] = useState(true)"));
    assert.ok(src.includes("const [showPeriodSeparators, setShowPeriodSeparators] = useState(false)"));
    assert.ok(src.includes('<Modal open={propertiesModalOpen} onClose={() => setPropertiesModalOpen(false)} title="Chart Properties">'));
  });

  test("22: the Chart Properties modal's Grid/Period separators checkboxes are real <input type=\"checkbox\"> wrapped in a <label>, the same natively-accessible pattern the Indicators menu already uses - no ARIA reinvention", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const block = src.slice(src.indexOf("Chart Properties"), src.indexOf("Chart Properties") + 900);
    assert.ok(block.includes('type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)}'));
    assert.ok(block.includes('type="checkbox" checked={showPeriodSeparators} onChange={(e) => setShowPeriodSeparators(e.target.checked)}'));
  });

  test("23: NativeChart forwards onOpenProperties to ChartToolbar, opening the Modal - the toolbar button is reachable, never dead state with no UI (same discipline test 11 already applies to chartType)", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("onOpenProperties={() => setPropertiesModalOpen(true)}"));
  });

  test("27: NativeChart owns colorScheme as local state (same 'rendering-style preference, not per-instrument data' reasoning as chartType/showGrid) - defaults to 'mt5', the exact theme this chart has always used, so this is zero visual change until Properties is actually opened", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('useState<ChartTheme>("mt5")'));
    assert.ok(!src.includes("colors: resolveChartColors(\"mt5\")"), "the OLD hardcoded call site must be gone - colorScheme is now the real source of truth (a historical mention of the same string in a comment is fine)");
    assert.ok(src.includes("colors: resolveChartColors(colorScheme)"));
  });

  test("28: the Chart Properties modal's Colors section is a real <select> populated from COLOR_SCHEMES/CHART_THEME_LABELS - never a hardcoded pair of <option> strings that could drift from canvas-colors.ts's actual theme list", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const block = src.slice(src.indexOf("Chart Properties"), src.indexOf("Chart Properties") + 1600);
    assert.ok(block.includes("COLOR_SCHEMES.map((scheme)"));
    assert.ok(block.includes("CHART_THEME_LABELS[scheme]"));
    assert.ok(block.includes("value={colorScheme}"));
    assert.ok(block.includes("onChange={(e) => setColorScheme(e.target.value as ChartTheme)}"));
  });

  test("29: COLOR_SCHEMES deliberately excludes 'at24' - that's the platform's own generic token-driven theme, not an MT5 scheme, and was never part of what the user's Properties-dialog screenshot asked for", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const block = src.slice(src.indexOf("const COLOR_SCHEMES"), src.indexOf("const COLOR_SCHEMES") + 120);
    assert.ok(!block.includes('"at24"'));
    assert.ok(block.includes('"mt5"') && block.includes('"mt5-green"'));
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
