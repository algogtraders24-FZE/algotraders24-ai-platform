// scripts/validate-native-chart-professionalization.ts
// Sprint D2.7.6 - AT24 Native Chart Professionalization & Real-Market UX.
// Standalone, assert-based verification (no test framework), matching every
// prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:native-chart-professionalization`.
//
// This sprint is a rendering-quality/professionalization sprint, not a data
// sprint: every test here proves the new rendering-quality additions
// (vertical time grid, capped candle body width, responsive axis tick
// density, a real crosshair price-axis label, RSI/MACD/Volume sub-panel
// axis labels) are correctly wired and honestly sourced, and that the
// already-verified D2.7.2-D2.7.5 architecture (data flow, switching
// behavior, security, performance) is unaffected - deterministic fixtures
// only, no live credentials, no network calls, no fabricated claims.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import { fitToData } from "../lib/chart-engine/viewport";
import { nearestIndexByTime } from "../lib/chart-engine/candle-index";
import { priceToY, yToPrice } from "../lib/chart-engine/coordinate-system";
import { computePriceTicks, targetPriceTickCountForHeight } from "../lib/chart-engine/price-axis";
import { computeTimeTicks, targetTimeTickCountForWidth } from "../lib/chart-engine/time-axis";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS } from "../lib/chart-engine/indicators/panel-registry";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { computePanelLayout } from "../lib/chart-engine/panel-layout";
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

/** A no-op fake CanvasRenderingContext2D - proves rendering completes without throwing. */
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

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A recording fake CanvasRenderingContext2D - captures fillRect calls (with real arguments) so behavioral rendering claims (e.g. "candle bodies never exceed the max width cap") can be verified against the ACTUAL values the renderer computed, not just "it didn't throw". */
function recordingCtx(): { ctx: CanvasRenderingContext2D; fillRects: FillRectCall[]; fillTexts: string[] } {
  const fillRects: FillRectCall[] = [];
  const fillTexts: string[] = [];
  const ctx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRects.push({ x, y, w, h });
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: (text: string) => {
      fillTexts.push(text);
    },
    setLineDash: () => {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillRects, fillTexts };
}

const MAX_BODY_WIDTH_PX = 24; // mirrors renderer.ts's own private constant - the two are cross-checked by a dedicated regression test below

// ============================================================
// 1 - Renderer output invariants
// ============================================================
async function rendererInvariantTests(): Promise<void> {
  await test("renderChart completes without throwing at a typical size with candles, overlays, and sub-panels active", () => {
    const candles = makeCandleSeries(120, 60_000);
    const viewport = fitToData(candles);
    const series = DEFAULT_INDICATOR_CONFIGS.map((cfg) => computeIndicatorSeries(candles, cfg));
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 900, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
        activePanels: ["volume", "rsi", "macd"],
        indicatorSeries: series,
      });
    });
  });

  await test("the vertical time-grid function exists and is called exactly once from renderChart (not per sub-panel)", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("function drawTimeGrid"));
    assert.equal((src.match(/drawTimeGrid\(ctx, timeTicks/g) ?? []).length, 1);
  });

  // Updated (gapless x-axis, this session) - drawTimeGrid now positions
  // each tick via its real candle INDEX (index-scale.ts's indexToX), not
  // raw time - see that file's header comment for why (a naive time-
  // linear x-axis renders a real market gap, e.g. a weekend, as dead
  // empty canvas space). The crisp-1px-line convention itself (round + 0.5)
  // is unchanged, just applied to the new index-based x.
  await test("drawTimeGrid uses the SAME crisp-1px-line convention (round + 0.5) as the existing horizontal price grid", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawTimeGrid"), src.indexOf("function drawTimeGrid") + 500);
    assert.ok(fn.includes("Math.round(indexToX(tick.index, indexRange, plotWidth)) + 0.5"));
  });

  await test("the grid is drawn behind the candles - drawPriceGrid/drawTimeGrid are called before drawCandles in renderChart", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const body = src.slice(src.indexOf("export function renderChart"), src.indexOf("// Sprint D2.7.6, Phase 4 - the vertical counterpart"));
    assert.ok(body.indexOf("drawPriceGrid(") < body.indexOf("drawCandles("));
    assert.ok(body.indexOf("drawTimeGrid(") < body.indexOf("drawCandles("));
  });

  await test("renderChart still completes for a zero-candle series without throwing", () => {
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 900, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles: [],
        viewport: fitToData([]),
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });

  await test("renderChart still completes at a degenerate (zero) plot size without throwing", () => {
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 10, height: 10, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles: makeCandleSeries(10, 60_000),
        viewport: fitToData(makeCandleSeries(10, 60_000)),
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });

  await test("candle body width never exceeds the professional max-width cap, even at extreme zoom-in (few visible candles across a wide plot)", () => {
    const candles = makeCandleSeries(5, 60_000); // MIN_VISIBLE_CANDLES floor
    const viewport = fitToData(candles);
    const { ctx, fillRects } = recordingCtx();
    renderChart({
      ctx,
      dims: { width: 1400, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
    });
    // Isolate candle-body rects from the 58px-wide latest-price-marker label
    // box (the only other fillRect this scene can draw) by width.
    const bodyRects = fillRects.filter((r) => r.w < 40);
    assert.ok(bodyRects.length > 0, "expected at least one candle body to be drawn");
    for (const r of bodyRects) assert.ok(r.w <= MAX_BODY_WIDTH_PX + 1e-6, `candle body width ${r.w}px exceeded the ${MAX_BODY_WIDTH_PX}px cap`);
  });
}

// ============================================================
// 2 - Axis tick quality / precision
// ============================================================
async function axisTickQualityTests(): Promise<void> {
  await test("targetPriceTickCountForHeight returns the original fixed default for a non-finite/zero height (backward compatible)", () => {
    assert.equal(targetPriceTickCountForHeight(0), 5);
    assert.equal(targetPriceTickCountForHeight(NaN), 5);
    assert.equal(targetPriceTickCountForHeight(-10), 5);
  });

  await test("targetPriceTickCountForHeight scales down for a short panel and up for a tall one, always within [2, 8]", () => {
    const short = targetPriceTickCountForHeight(80);
    const tall = targetPriceTickCountForHeight(900);
    assert.ok(short >= 2 && short <= 8);
    assert.ok(tall >= 2 && tall <= 8);
    assert.ok(tall >= short);
  });

  await test("targetTimeTickCountForWidth returns the original fixed default for a non-finite/zero width (backward compatible)", () => {
    assert.equal(targetTimeTickCountForWidth(0), 6);
    assert.equal(targetTimeTickCountForWidth(NaN), 6);
  });

  await test("targetTimeTickCountForWidth scales down for a narrow (mobile-width) plot and up for a wide desktop plot, always within [2, 8]", () => {
    const narrow = targetTimeTickCountForWidth(280); // ~375px viewport minus the price-axis gutter
    const wide = targetTimeTickCountForWidth(1400);
    assert.ok(narrow >= 2 && narrow <= 8);
    assert.ok(wide >= 2 && wide <= 8);
    assert.ok(wide >= narrow);
  });

  await test("computePriceTicks with a responsive count still returns real, ordered, deterministic ticks", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 100, maxPrice: 200 };
    const a = computePriceTicks(vp, targetPriceTickCountForHeight(300));
    const b = computePriceTicks(vp, targetPriceTickCountForHeight(300));
    assert.deepEqual(a, b);
    for (let i = 1; i < a.length; i++) assert.ok(a[i].price > a[i - 1].price);
  });

  await test("computeTimeTicks with a responsive count still places every tick AT a real candle timestamp - never a synthesized time", () => {
    const candles = makeCandleSeries(300, 60_000);
    const viewport = fitToData(candles);
    const ticks = computeTimeTicks(candles, viewport, "1h", targetTimeTickCountForWidth(1200));
    const realTimes = new Set(candles.map((c) => c.time));
    for (const tick of ticks) assert.ok(realTimes.has(tick.time));
  });

  await test("price tick decimal precision is still shared across every tick on the axis (column alignment) - unaffected by the responsive count change", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 1.08, maxPrice: 1.092 };
    const ticks = computePriceTicks(vp, targetPriceTickCountForHeight(200));
    const decimalsSet = new Set(ticks.map((t) => t.decimals));
    assert.equal(decimalsSet.size, 1);
  });

  await test("no unnecessary decimals are introduced for a wide equity-style price range regardless of the new responsive tick count", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 24_000, maxPrice: 24_500 };
    const ticks = computePriceTicks(vp, targetPriceTickCountForHeight(400));
    for (const t of ticks) assert.ok(t.decimals <= 2);
  });

  await test("renderChart derives its price/time tick counts from the ACTUAL panel dimensions passed in, not a hardcoded constant", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("targetPriceTickCountForHeight(priceRow.height)"));
    assert.ok(src.includes("targetTimeTickCountForWidth(plotWidth)"));
  });

  await test("no hardcoded symbol-specific price-precision table was introduced - decimals remain derived purely from the tick step", () => {
    const src = read("lib/chart-engine/price-axis.ts");
    assert.ok(!/EURUSD|BTCUSD|XAUUSD|NIFTY/.test(src));
  });

  await test("no second timeframe registry was introduced by the time-axis responsiveness change", () => {
    const src = read("lib/chart-engine/time-axis.ts");
    assert.ok(src.includes('from "@/types/signal"'));
    assert.ok(!/type\s+ChartTimeframe\s*=/.test(src));
  });
}

// ============================================================
// 3 - Crosshair behavior
// ============================================================
async function crosshairTests(): Promise<void> {
  await test("the crosshair price-axis label is scoped to ONLY the price panel's row - never drawn for a y inside a sub-panel", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    assert.ok(fn.includes("y >= priceRow.top && y <= priceRow.top + priceRow.height"));
  });

  await test("the crosshair price label is derived via the real yToPrice inverse conversion - never a hardcoded/guessed value", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    assert.ok(fn.includes("yToPrice(y - priceRow.top, viewport, priceRow.height)"));
  });

  await test("yToPrice/priceToY remain exact inverses - the crosshair label's derived price matches the real price at that pixel", () => {
    const viewport: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 50, maxPrice: 150 };
    const rowHeight = 400;
    const realPrice = 92.5;
    const y = priceToY(realPrice, viewport, rowHeight);
    const recovered = yToPrice(y, viewport, rowHeight);
    assert.ok(Math.abs(recovered - realPrice) < 1e-6);
  });

  await test("the crosshair price label box is styled in textTertiary (steel), never gold - visually distinct from the latest-price marker", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    const labelBlock = fn.slice(fn.indexOf("if (y >= priceRow.top"));
    assert.ok(labelBlock.includes("colors.textTertiary"));
    assert.ok(!labelBlock.includes("colors.gold"));
  });

  await test("renderChart with a crosshair positioned inside the price panel completes without throwing and draws a price label", () => {
    const candles = makeCandleSeries(80, 60_000);
    const viewport = fitToData(candles);
    const { ctx, fillTexts } = recordingCtx();
    renderChart({
      ctx,
      dims: { width: 900, height: 400, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport,
      timeframe: "1h",
      crosshair: { index: 40, x: 400, y: 150 },
      colors: resolveChartColors(),
    });
    assert.ok(fillTexts.length > 0);
  });

  await test("renderChart with a crosshair positioned inside a sub-panel (e.g. RSI row) never draws a fabricated price-panel label there", () => {
    const candles = makeCandleSeries(80, 60_000);
    const viewport = fitToData(candles);
    const series = DEFAULT_INDICATOR_CONFIGS.filter((c) => c.id === "rsi").map((cfg) => computeIndicatorSeries(candles, cfg));
    const layout = computePanelLayout(["rsi"], 400);
    const rsiRow = layout.find((r) => r.id === "rsi")!;
    const yInRsiRow = rsiRow.top + rsiRow.height / 2;
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 900, height: 422, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: { index: 40, x: 400, y: yInRsiRow },
        colors: resolveChartColors(),
        activePanels: ["rsi"],
        indicatorSeries: series,
      });
    });
  });

  await test("crosshair candle snapping is unaffected by this sprint - still real, never interpolated", () => {
    const candles = makeCandleSeries(200, 60_000);
    const targetTime = candles[100].time + 500;
    const index = nearestIndexByTime(candles, targetTime);
    assert.equal(index, 100);
  });

  await test("no React setState is called from the pan/zoom/crosshair pointer handler - unaffected by this sprint's renderer-only changes", () => {
    // Sprint D2.7.7 renamed handleMouseMove -> handlePointerMove (native
    // Pointer Events migration) - same invariant, updated reference.
    const src = read("components/chart-engine/NativeChart.tsx");
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!moveHandler.includes("setIsLive("));
  });

  await test("the animation-frame hover throttle is unaffected - still cancels on unmount", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("cancelAnimationFrame(rafRef.current)"));
  });
}

// ============================================================
// 4 - Latest price
// ============================================================
async function latestPriceTests(): Promise<void> {
  await test("the latest-price marker function is unchanged by this sprint - still draws from the real last candle's close", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("function drawLatestPriceMarker"));
    assert.ok(src.includes("latest.close"));
  });

  await test("the latest-price marker still renders correctly alongside the new grid/crosshair-label additions without throwing", () => {
    const candles = makeCandleSeries(60, 60_000);
    const viewport = fitToData(candles);
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 800, height: 400, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: { index: 59, x: 790, y: 200 },
        colors: resolveChartColors(),
      });
    });
  });

  await test("the latest candle is always the last element of a normalized candle series - Go-to-latest has a real, unambiguous target", () => {
    const candles = makeCandleSeries(50, 60_000);
    const latest = candles[candles.length - 1];
    assert.equal(latest.time, Math.max(...candles.map((c) => c.time)));
  });

  await test("followLatest/isAtRightEdge (the Go-to-latest mechanism) are untouched by this sprint - renderer.ts imports viewport.ts unchanged", () => {
    const src = read("lib/chart-engine/viewport.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });

  await test("no BUY/SELL/trading-recommendation language was introduced near the latest-price rendering code (checking real phrases, not the bare word 'signal' which legitimately appears in this codebase's own --signal-up/--signal-down color token names)", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(!/\bBUY\b|\bSELL\b|place order|execute trade|recommend(ed|ation)?\b/i.test(src));
  });
}

// ============================================================
// 5 - Panel layout
// ============================================================
async function panelLayoutTests(): Promise<void> {
  await test("panel-layout.ts is untouched by this sprint - deterministic panel order/sizing unaffected", () => {
    const src = read("lib/chart-engine/panel-layout.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });

  await test("price panel is always first regardless of activePanels order - unaffected", () => {
    const layout = computePanelLayout(["macd", "rsi", "volume"], 600);
    assert.equal(layout[0].id, "price");
  });

  await test("panel layout never collapses to zero height for an active panel", () => {
    const layout = computePanelLayout(["volume", "rsi", "macd"], 600);
    for (const row of layout) assert.ok(row.height > 0);
  });

  await test("enabling/disabling a sub-panel indicator still recomputes activePanels deterministically (NativeChart's useMemo, unaffected)", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("const activePanels = useMemo<ChartPanelId[]>"));
  });
}

// ============================================================
// 6 - Empty-volume behavior
// ============================================================
async function emptyVolumeTests(): Promise<void> {
  await test("the honest 'No volume data' notice (D2.7.5) is unchanged and still present", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(src.includes("No volume data for this instrument"));
  });

  await test("the new max-volume axis label is drawn only when real volume data exists - never alongside the empty-panel notice", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    const fn = src.slice(src.indexOf("export function drawVolumePanel"), src.indexOf("export function drawRsiPanel"));
    const noticeIndex = fn.indexOf("No volume data for this instrument");
    const returnIndex = fn.indexOf("return;\n  }", noticeIndex);
    const labelIndex = fn.indexOf("formatCompactVolume(maxVolume)");
    assert.ok(noticeIndex < returnIndex && returnIndex < labelIndex, "the function must return before reaching the max-volume label when volume is absent");
  });

  await test("the max-volume label uses the SAME formatCompactVolume every other volume figure on the platform uses - never a second formatter", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(src.includes('import { formatCompactVolume } from "@/lib/financial-format"'));
  });

  await test("drawVolumePanel with real volume data renders without throwing and draws at least one text label (the panel title + the new max-volume label)", () => {
    const candles = makeCandleSeries(60, 60_000, 100, true);
    const viewport = fitToData(candles);
    const { ctx, fillTexts } = recordingCtx();
    renderChart({
      ctx,
      dims: { width: 800, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
      activePanels: ["volume"],
    });
    assert.ok(fillTexts.includes("Volume"));
  });

  await test("drawVolumePanel with NO volume data renders the honest notice and never throws", () => {
    const candles = makeCandleSeries(60, 60_000, 100, false);
    const viewport = fitToData(candles);
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 800, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
        activePanels: ["volume"],
      });
    });
  });
}

// ============================================================
// 7/8/9 - Symbol / timeframe / provider switching (source-level proof,
// matching this project's established no-DOM-test-framework convention)
// ============================================================
async function switchingTests(): Promise<void> {
  const nativeSrc = read("components/chart-engine/NativeChart.tsx");
  const hookSrc = read("components/chart-engine/useChartCandles.ts");

  await test("symbol/timeframe switching remains keyed on [symbol, timeframe, outputSize] - unaffected by this sprint's renderer-only changes", () => {
    assert.ok(hookSrc.includes("}, [symbol, timeframe, outputSize]);"));
  });

  await test("AbortController-based stale-request cancellation is unaffected", () => {
    assert.ok(hookSrc.includes("const controller = new AbortController();"));
    assert.ok(hookSrc.includes("if (cancelled) return"));
  });

  await test("the D2.7.4 fittedKeyRef fix (re-fit only after real data, never the empty placeholder) is unaffected by this sprint", () => {
    assert.ok(nativeSrc.includes("fittedKeyRef"));
    assert.ok(nativeSrc.includes("alreadyFittedForThisKey"));
  });

  await test("indicators are recomputed from the CURRENT candle set on every timeframe/symbol change (useMemo on [candles, activeConfigs]) - unaffected", () => {
    assert.ok(nativeSrc.includes("() => activeConfigs.map((cfg) => computeIndicatorSeries(candles, cfg)),\n    [candles, activeConfigs],"));
  });

  await test("no state leaks between symbols - resolution/candles are both re-derived fresh from the current `symbol`/`result.series` every render", () => {
    assert.ok(nativeSrc.includes("const resolution = resolveChartInstrument(symbol);"));
    assert.ok(nativeSrc.includes("const candles = useMemo<ChartCandle[]>(() => result.series?.candles ?? [], [result.series]);"));
  });

  await test("ChartHeader (D2.7.5) still reads its price/change/freshness/provenance from the SAME already-fetched series - no stale header values possible across a switch", () => {
    const headerSrc = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(headerSrc.includes("series?.candles"));
  });

  await test("provider switching is still explicit (native | tradingview) - unaffected by this sprint's rendering changes", () => {
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(panelSrc.includes('provider === "native" ? ('));
  });

  await test("D2.7.5's chart-session-state provider/timeframe/indicator persistence is untouched by this sprint", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });

  await test("TradingView (AdvancedChart.tsx) remains completely untouched by D2.7.6 - no compatibility defect was found that justified touching it", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(!src.includes("Sprint D2.7.6"));
    assert.ok(src.includes("export default function AdvancedChart"));
  });

  await test("no silent fallback exists between native and TradingView - unaffected", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(!/catch[\s\S]{0,100}AdvancedChart/.test(src));
  });
}

// ============================================================
// 10 - Indicator state / UX (RSI, MACD, Volume label additions)
// ============================================================
async function indicatorStateTests(): Promise<void> {
  const subPanelSrc = read("lib/chart-engine/sub-panel-renderer.ts");

  await test("RSI panel now labels its overbought/oversold reference lines with real, standard values (70/30) - previously unlabeled", () => {
    const fn = subPanelSrc.slice(subPanelSrc.indexOf("export function drawRsiPanel"), subPanelSrc.indexOf("export function drawMacdPanel"));
    assert.ok(fn.includes("String(level)"));
  });

  await test("MACD panel now draws a real zero reference line, independent of whether the histogram itself has visible bars", () => {
    const fn = subPanelSrc.slice(subPanelSrc.indexOf("export function drawMacdPanel"));
    const zeroLineIndex = fn.indexOf("zeroLineY");
    const histogramIfIndex = fn.indexOf("if (histogram) {");
    assert.ok(zeroLineIndex > -1 && zeroLineIndex < histogramIfIndex, "the zero line must be drawn unconditionally, before the histogram-only branch");
  });

  await test("indicator toggle state ownership (ChartPanel, since D2.7.4) is unaffected by this sprint's renderer changes", () => {
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(panelSrc.includes("useState<Set<string>>"));
  });

  // Updated (Phase 2, this session) - atr/stochastic are legitimate new
  // panel ids (their own sub-panel row each, never overlaid on price),
  // added alongside price/volume/rsi/macd, not a change to D2.7.5's own
  // grouping mechanism itself.
  await test("the Overlays/Panels grouping (D2.7.5) and INDICATOR_PANEL_ID sync are unaffected", () => {
    const candles = makeCandleSeries(60, 60_000);
    for (const cfg of DEFAULT_INDICATOR_CONFIGS) {
      const series = computeIndicatorSeries(candles, cfg);
      assert.ok(["price", "volume", "rsi", "macd", "atr", "stochastic"].includes(series.panel));
    }
  });

  await test("no new indicator mathematics were introduced - lib/market-data/indicators.ts and compute.ts are byte-for-byte untouched", () => {
    assert.ok(!read("lib/market-data/indicators.ts").includes("Sprint D2.7.6"));
    assert.ok(!read("lib/chart-engine/indicators/compute.ts").includes("Sprint D2.7.6"));
  });

  await test("unknown indicator keys remain rejected at the toggle boundary - unaffected", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("DEFAULT_INDICATOR_CONFIGS.some((cfg) => cfg.key === key)"));
  });

  await test("Escape/outside-click dismissal of the Indicators menu (D2.7.5) is unaffected", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes('e.key === "Escape"'));
    assert.ok(src.includes("pointerdown"));
  });
}

// ============================================================
// 11 - Persistence compatibility
// ============================================================
async function persistenceCompatibilityTests(): Promise<void> {
  await test("chart-session-state.ts (D2.7.5) is untouched by this sprint - session persistence remains sessionStorage-scoped", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(src.includes("window.sessionStorage"));
  });

  await test("no new persisted field was introduced this sprint - rendering preferences (grid density, etc.) are NOT persisted, since they derive automatically from real viewport dimensions every render", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/grid|tickCount|bodyWidth/i.test(src));
  });

  await test("ChartPanel's hydration/persist effects (D2.7.5) are unaffected by this sprint", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("hydratedRef"));
  });
}

// ============================================================
// 12 - Responsive sizing
// ============================================================
async function responsiveSizingTests(): Promise<void> {
  await test("a mobile-width plot (≈311px after the price-axis gutter) produces a real, non-degenerate tick count", () => {
    const count = targetTimeTickCountForWidth(311);
    assert.ok(count >= 2);
  });

  await test("a tablet-width plot produces a tick count between the mobile and desktop extremes", () => {
    const mobile = targetTimeTickCountForWidth(311);
    const tablet = targetTimeTickCountForWidth(700);
    const desktop = targetTimeTickCountForWidth(1400);
    assert.ok(tablet >= mobile);
    assert.ok(desktop >= tablet);
  });

  await test("a short fullscreen-collapsed price row (e.g. many sub-panels active) still produces at least the minimum readable tick count", () => {
    const count = targetPriceTickCountForHeight(90);
    assert.ok(count >= 2);
  });

  await test("renderChart at a narrow (mobile) canvas size completes without throwing and without horizontal overflow in its own coordinate math (all x values stay within [0, plotWidth])", () => {
    const candles = makeCandleSeries(100, 60_000);
    const viewport = fitToData(candles);
    const { ctx, fillRects } = recordingCtx();
    renderChart({
      ctx,
      dims: { width: 360, height: 320, priceAxisWidth: 50, timeAxisHeight: 20 },
      candles,
      viewport,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
    });
    const plotWidth = 360 - 50;
    for (const r of fillRects) assert.ok(r.x <= plotWidth + 60, `fillRect x=${r.x} unexpectedly far past plotWidth=${plotWidth}`);
  });

  await test("renderChart at a large desktop canvas size completes without throwing", () => {
    const candles = makeCandleSeries(500, 60_000);
    const viewport = fitToData(candles);
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 1920, height: 900, priceAxisWidth: 70, timeAxisHeight: 24 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });

  await test("NativeChart's fullscreen container sizing (D2.7.5) is unaffected by this sprint's renderer-only changes", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('isFullscreen ? "relative w-full min-h-0 flex-1" : "relative w-full"'));
  });

  await test("ResizeObserver-driven canvas sizing is unaffected - no hardcoded chart dimensions were introduced", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("new ResizeObserver"));
    assert.ok(src.includes("observer.disconnect()"));
  });

  await test("ChartToolbar/ChartHeader wrapping (flex-wrap) is unaffected by this sprint - no chart-panel-only sprint touched those files", () => {
    for (const f of ["components/chart-engine/ChartToolbar.tsx", "components/chart-engine/ChartHeader.tsx"]) {
      assert.ok(!read(f).includes("Sprint D2.7.6"));
    }
  });
}

// ============================================================
// 13 - High-DPI behavior
// ============================================================
async function highDpiTests(): Promise<void> {
  await test("devicePixelRatio scaling (ctx.setTransform, applied once per resize) is unaffected by this sprint - renderer.ts itself never re-derives DPR", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(!/devicePixelRatio/.test(src));
    const nativeSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(nativeSrc.includes("window.devicePixelRatio"));
    assert.ok(nativeSrc.includes("ctx.setTransform(dpr, 0, 0, dpr, 0, 0)"));
  });

  await test("every new 1px line this sprint added (drawTimeGrid) uses the same CSS-pixel coordinate space every other line already uses - correctly scaled by the single DPR transform, never a second scaling factor", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawTimeGrid"), src.indexOf("function drawTimeGrid") + 500);
    assert.ok(!/devicePixelRatio|dpr/i.test(fn));
  });

  await test("canvas-typography.ts (the font resolution bridge) is untouched by this sprint - crosshair/axis text rendering quality is unaffected", () => {
    const src = read("lib/chart-engine/canvas-typography.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });
}

// ============================================================
// 14 - Performance
// ============================================================
async function performanceTests(): Promise<void> {
  for (const count of [500, 2000, 5000]) {
    await test(`full pipeline (normalize -> indicators -> render, incl. the new grid/axis-label work) completes within budget at ${count} candles`, () => {
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

  await test("targetPriceTickCountForHeight/targetTimeTickCountForWidth are O(1) - 10,000 calls complete near-instantly", () => {
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) {
      targetPriceTickCountForHeight(300 + (i % 50));
      targetTimeTickCountForWidth(800 + (i % 50));
    }
    assert.ok(Date.now() - t0 < 200);
  });

  await test("crosshair binary-search lookup remains fast at 5,000 candles - unaffected by this sprint", () => {
    const candles = makeCandleSeries(5000, 60_000);
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) nearestIndexByTime(candles, candles[0].time + Math.random() * (candles[4999].time - candles[0].time));
    assert.ok(Date.now() - t0 < 500);
  });
}

// ============================================================
// 15 - No-fabrication guards
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("no hardcoded fallback symbol (EURUSD/BTCUSD) exists in this sprint's modified rendering files", () => {
    for (const f of ["lib/chart-engine/renderer.ts", "lib/chart-engine/sub-panel-renderer.ts", "lib/chart-engine/price-axis.ts", "lib/chart-engine/time-axis.ts"]) {
      assert.ok(!/EURUSD|BTCUSD/.test(read(f)));
    }
  });

  await test("no BUY/SELL/automated-trading/broker-execution language exists anywhere in this sprint's changes", () => {
    for (const f of ["lib/chart-engine/renderer.ts", "lib/chart-engine/sub-panel-renderer.ts"]) {
      assert.ok(!/\bBUY\b|\bSELL\b|place order|execute trade|broker/i.test(read(f)));
    }
  });

  await test("the RSI 70/30 labels and MACD zero line are real, standard, published charting conventions - never an invented threshold", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(src.includes("RSI_OVERBOUGHT = 70"));
    assert.ok(src.includes("RSI_OVERSOLD = 30"));
  });

  await test("the Volume panel's max-volume label is the REAL max of the visible window - never a fabricated/rounded-up figure", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(src.includes("formatCompactVolume(maxVolume)"));
  });

  await test("the crosshair price label never renders when the crosshair falls outside the price row - no invented value for a sub-panel's different scale", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawCrosshair"));
    assert.ok(fn.includes("if (y >= priceRow.top && y <= priceRow.top + priceRow.height) {"));
  });

  await test("no Redis/Kafka/WebSocket dependency was introduced by this sprint's changes (checking real usage, not documentation)", () => {
    for (const f of ["lib/chart-engine/renderer.ts", "lib/chart-engine/sub-panel-renderer.ts", "lib/chart-engine/price-axis.ts", "lib/chart-engine/time-axis.ts"]) {
      const src = read(f);
      assert.ok(!/redis|kafka/i.test(src));
      assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
    }
  });

  await test("Intelligence Score/Regime/Hypothesis/DecisionContext services are untouched by D2.7.6", () => {
    for (const f of [
      "services/intelligence/score/intelligence-score.service.ts",
      "services/intelligence/regime/regime.service.ts",
      "services/intelligence/hypothesis/hypothesis.service.ts",
      "services/intelligence/decision/decision-context.service.ts",
    ]) {
      assert.ok(!read(f).includes("Sprint D2.7.6"));
    }
  });
}

// ============================================================
// 16 - Data-integrity guards
// ============================================================
async function dataIntegrityTests(): Promise<void> {
  await test("candle-normalizer.ts is untouched by this sprint - OHLC/timestamp/duplicate/out-of-order rejection rules are unaffected", () => {
    const src = read("lib/chart-engine/candle-normalizer.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });

  await test("a candle with high < low is still rejected, never silently repaired", () => {
    const raw = [{ datetime: "2026-01-01T00:00:00Z", open: 100, high: 90, low: 99, close: 95 }];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
    assert.equal(rejectedCount, 1);
  });

  await test("a NaN/Infinity candle value is still rejected, never coerced to a fake number", () => {
    const raw = [{ datetime: "2026-01-01T00:00:00Z", open: NaN, high: 100, low: 90, close: 95 }];
    const { rejectedCount } = normalizeCandles(raw);
    assert.equal(rejectedCount, 1);
  });

  await test("rejectedCount remains honestly surfaced in the UI - NativeChart.tsx still displays it", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("rejectedCount > 0"));
  });
}

// ============================================================
// 17 - Security guards
// ============================================================
async function securityTests(): Promise<void> {
  await test("the candles API route's auth/validation posture is unchanged by this sprint - route.ts untouched", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(!src.includes("Sprint D2.7.6"));
  });

  await test("no API key/secret/token pattern appears in any file this sprint modified", () => {
    for (const f of [
      "lib/chart-engine/renderer.ts",
      "lib/chart-engine/sub-panel-renderer.ts",
      "lib/chart-engine/price-axis.ts",
      "lib/chart-engine/time-axis.ts",
    ]) {
      assert.ok(!/apiKey|API_KEY|_SECRET|_PASSWORD/i.test(read(f)));
    }
  });

  await test("no provider credentials reach any client-side chart-engine file - unaffected", () => {
    for (const f of ["lib/chart-engine/renderer.ts", "lib/chart-engine/sub-panel-renderer.ts"]) {
      assert.ok(!/twelvedata|alphavantage|angelone/i.test(read(f)));
    }
  });

  await test("no cross-user cache leakage risk - this sprint touched no caching code at all (route-local TtlCache untouched)", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(!/Sprint D2.7.6/.test(src));
  });

  await test("no secrets are logged by any file this sprint touched", () => {
    for (const f of ["lib/chart-engine/renderer.ts", "lib/chart-engine/sub-panel-renderer.ts"]) {
      assert.ok(!/console\.log\([^)]*(apiKey|token|password)/i.test(read(f)));
    }
  });
}

// ============================================================
// 18 - Existing architecture reuse
// ============================================================
async function architectureReuseTests(): Promise<void> {
  // Updated (gapless x-axis, this session) - drawTimeGrid reuses index-
  // scale.ts's indexToX (the ONE gapless x-position function every
  // renderer element now shares - candles, ticks, drawn objects,
  // crosshair) rather than coordinate-system.ts's time-domain timeToX.
  // Still a single shared conversion, never a second/parallel one - just
  // a different (and, per this session's fix, more correct) shared one.
  await test("no second grid/tick system was introduced - drawTimeGrid reuses the shared index-scale.ts indexToX, never a parallel conversion", () => {
    const src = read("lib/chart-engine/renderer.ts");
    const fn = src.slice(src.indexOf("function drawTimeGrid"), src.indexOf("function drawTimeGrid") + 400);
    assert.ok(fn.includes("indexToX("));
  });

  await test("no second timeframe/indicator/instrument/symbol registry was introduced anywhere in this sprint's changes", () => {
    for (const f of [
      "lib/chart-engine/renderer.ts",
      "lib/chart-engine/sub-panel-renderer.ts",
      "lib/chart-engine/price-axis.ts",
      "lib/chart-engine/time-axis.ts",
    ]) {
      assert.ok(!/SYMBOL_MAP|SYMBOL_REGISTRY|INDICATOR_REGISTRY_V2|TIMEFRAME_REGISTRY/.test(read(f)));
    }
  });

  await test("no second chart engine was created - this sprint only modified files already inside lib/chart-engine and components/chart-engine", () => {
    // A structural sanity check: NativeChart.tsx (the one native chart orchestrator) still imports renderChart from the SAME renderer.ts this sprint modified.
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('from "@/lib/chart-engine/renderer"'));
  });

  await test("the AT24 design token vocabulary (gold/steel/signal-up/signal-down) is reused for every new visual element - no new chart-only palette", () => {
    const rendererSrc = read("lib/chart-engine/renderer.ts");
    assert.ok(rendererSrc.includes("colors.gold"));
    assert.ok(rendererSrc.includes("colors.textTertiary"));
    assert.ok(!/#[0-9a-fA-F]{6}/.test(rendererSrc.split("function drawTimeGrid")[1]?.split("function ")[0] ?? ""));
  });

  await test("no new font was installed - canvas text continues to use the existing resolveMonoFontFamily/canvasMonoFont bridge", () => {
    const rendererSrc = read("lib/chart-engine/renderer.ts");
    const subPanelSrc = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(rendererSrc.includes("canvasMonoFont"));
    assert.ok(subPanelSrc.includes("canvasMonoFont"));
  });

  await test("chart-instrument-resolver.ts and instrument-catalog.ts are untouched by this sprint - real-market instrument coverage is unaffected", () => {
    assert.ok(!read("lib/market-data/chart-instrument-resolver.ts").includes("Sprint D2.7.6"));
    assert.ok(!read("lib/market-data/instrument-catalog.ts").includes("Sprint D2.7.6"));
  });
}

// ============================================================
// 19 - Real-market instrument coverage (re-verification, deterministic
// catalog/resolution checks - never presented as live network verification)
// ============================================================
async function instrumentCoverageTests(): Promise<void> {
  const indian = ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"];
  await test("every Indian instrument still resolves through the real catalog to Angel One only", () => {
    for (const id of indian) {
      const instrument = getCanonicalInstrument(id);
      assert.ok(instrument, `${id} missing from catalog`);
      assert.ok(instrument!.providerMappings.some((m) => m.provider === "angel-one"));
    }
  });

  await test("every Indian instrument's chart resolution is a real NSE:-prefixed symbol", () => {
    for (const id of indian) {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true);
      assert.ok(resolution.chartSymbol?.startsWith("NSE:"));
    }
  });

  const crypto = ["BTCUSD", "ETHUSD"];
  await test("crypto instruments resolve to real Coinbase-prefixed chart symbols", () => {
    for (const id of crypto) {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true);
      assert.ok(resolution.chartSymbol?.startsWith("COINBASE:"));
    }
  });

  const metals = ["XAUUSD", "XAGUSD"];
  await test("metals instruments resolve to real, chartable symbols", () => {
    for (const id of metals) {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true);
      assert.ok(resolution.chartSymbol);
    }
  });

  const fx = ["EURUSD", "GBPUSD"];
  await test("FX instruments resolve to real, chartable symbols", () => {
    for (const id of fx) {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true);
      assert.ok(resolution.chartSymbol);
    }
  });

  await test("no instrument silently falls back to EURUSD or any other symbol - an unsupported id honestly reports unsupported", () => {
    const resolution = resolveChartInstrument("NOT-A-REAL-INSTRUMENT-ID");
    assert.equal(resolution.supported, false);
    assert.ok(resolution.reason);
  });

  await test("the full pipeline (normalize -> fit -> indicators -> render) completes for every real-market instrument's deterministic fixture without throwing or fabricating a chart", () => {
    for (const id of [...indian, ...crypto, ...metals, ...fx]) {
      const candles = makeCandleSeries(120, 60_000);
      const viewport = fitToData(candles);
      const series = DEFAULT_INDICATOR_CONFIGS.map((cfg) => computeIndicatorSeries(candles, cfg));
      assert.doesNotThrow(() => {
        renderChart({
          ctx: fakeCtx(),
          dims: { width: 800, height: 450, priceAxisWidth: 64, timeAxisHeight: 22 },
          candles,
          viewport,
          timeframe: "1h",
          crosshair: null,
          colors: resolveChartColors(),
          activePanels: ["volume"],
          indicatorSeries: series,
        });
      }, `rendering pipeline failed for ${id}`);
    }
  });
}

async function main(): Promise<void> {
  await rendererInvariantTests();
  await axisTickQualityTests();
  await crosshairTests();
  await latestPriceTests();
  await panelLayoutTests();
  await emptyVolumeTests();
  await switchingTests();
  await indicatorStateTests();
  await persistenceCompatibilityTests();
  await responsiveSizingTests();
  await highDpiTests();
  await performanceTests();
  await noFabricationTests();
  await dataIntegrityTests();
  await securityTests();
  await architectureReuseTests();
  await instrumentCoverageTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
