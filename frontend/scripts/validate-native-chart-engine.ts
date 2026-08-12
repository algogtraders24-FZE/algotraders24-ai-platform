// scripts/validate-native-chart-engine.ts
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation. Standalone,
// assert-based verification (no test framework), matching every prior
// sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:native-chart-engine`.
//
// The pure engine core (lib/chart-engine/*) is tested directly as
// deterministic functions - no DOM/Canvas needed for coordinate math,
// viewport, axis-tick, classification, or crosshair logic. The renderer
// (which DOES need a CanvasRenderingContext2D) is exercised against a
// minimal recording fake implementing only the drawing calls it uses -
// enough to prove it runs end-to-end on real data without throwing,
// without needing a browser. Component-level contracts (chart provider
// boundary, workspace wiring, honest states) are verified via source
// inspection, the same structural-check discipline D2.6.x/D2.7.1's own
// regression scripts already established for this codebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import { priceToY, yToPrice, timeToX, xToTime } from "../lib/chart-engine/coordinate-system";
import { fitToData, panViewport, priceRangeForWindow, zoomViewport, candleStepMs } from "../lib/chart-engine/viewport";
import { computePriceTicks } from "../lib/chart-engine/price-axis";
import { computeTimeTicks, timeAxisGranularity } from "../lib/chart-engine/time-axis";
import { classifyCandle } from "../lib/chart-engine/candle-classifier";
import { nearestCandleIndex } from "../lib/chart-engine/crosshair";
import { resolveMonoFontFamily, canvasMonoFont } from "../lib/chart-engine/canvas-typography";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { renderChart } from "../lib/chart-engine/renderer";
import { formatTimestamp } from "../lib/financial-format";
import { isSignalTimeframe, SIGNAL_TIMEFRAMES } from "../types/signal";
import type { Candle } from "../types/market-candle";
import type { ChartCandle } from "../types/chart-data";
import type { Viewport } from "../lib/chart-engine/types";

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

function rawCandle(datetime: string, o: number, h: number, l: number, c: number, volume?: number): Candle {
  return { datetime, open: o, high: h, low: l, close: c, volume };
}

function chartCandle(time: number, o: number, h: number, l: number, c: number, volume?: number): ChartCandle {
  return { time, open: o, high: h, low: l, close: c, volume };
}

function makeSeries(count: number, stepMs = 60_000, base = 100): ChartCandle[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + i;
    const c = base + i + (i % 2 === 0 ? 1 : -1);
    const h = Math.max(o, c) + 1;
    const l = Math.min(o, c) - 1;
    out.push(chartCandle(start + i * stepMs, o, h, l, c, 1000 + i));
  }
  return out;
}

// ============================================================
// 1-12: candle-normalizer (Phase 17 data-integrity validation)
// ============================================================
function candleNormalizerTests(): void {
  test("1: a clean, ordered candle series survives normalization intact", () => {
    const raw = [
      rawCandle("2026-01-01T00:00:00Z", 100, 102, 99, 101, 500),
      rawCandle("2026-01-01T00:01:00Z", 101, 103, 100, 102, 600),
    ];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 2);
    assert.equal(rejectedCount, 0);
  });

  test("2: NaN close is rejected, never repaired/replaced", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, 102, 99, NaN)];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
    assert.equal(rejectedCount, 1);
  });

  test("3: Infinity high is rejected", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, Infinity, 99, 101)];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("4: missing (undefined) open is rejected", () => {
    const raw = [{ datetime: "2026-01-01T00:00:00Z", open: undefined as unknown as number, high: 102, low: 99, close: 101 }];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("5: high < low is rejected (structurally invalid OHLC)", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, 90, 99, 95)];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("6: open above high is rejected", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 200, 150, 90, 120)];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("7: close below low is rejected", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, 110, 90, 80)];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("8: an unparseable datetime is rejected", () => {
    const raw = [rawCandle("not-a-date", 100, 102, 99, 101)];
    assert.equal(normalizeCandles(raw).rejectedCount, 1);
  });

  test("9: a duplicate timestamp is rejected, never silently deduplicated into the output twice", () => {
    const raw = [
      rawCandle("2026-01-01T00:00:00Z", 100, 102, 99, 101),
      rawCandle("2026-01-01T00:00:00Z", 101, 103, 100, 102),
    ];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 1);
    assert.equal(rejectedCount, 1);
  });

  test("10: an out-of-order (earlier) timestamp is rejected, never silently re-sorted", () => {
    const raw = [
      rawCandle("2026-01-01T00:02:00Z", 100, 102, 99, 101),
      rawCandle("2026-01-01T00:01:00Z", 101, 103, 100, 102),
    ];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 1);
    assert.equal(rejectedCount, 1);
  });

  test("11: an invalid negative volume drops only the volume field, never the whole candle", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, 102, 99, 101, -5)];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 1);
    assert.equal(rejectedCount, 0);
    assert.equal(candles[0].volume, undefined);
  });

  test("12: a genuinely absent volume stays absent - never fabricated as 0", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", 100, 102, 99, 101)];
    const { candles } = normalizeCandles(raw);
    assert.equal(candles[0].volume, undefined);
  });
}

// ============================================================
// 13-20: coordinate-system (Phase 6, deterministic conversions)
// ============================================================
function coordinateSystemTests(): void {
  const viewport: Viewport = { minTime: 0, maxTime: 1000, minPrice: 10, maxPrice: 20 };

  test("13: priceToY places the max price at the top (y=0)", () => {
    assert.equal(priceToY(20, viewport, 100), 0);
  });

  test("14: priceToY places the min price at the bottom", () => {
    assert.equal(priceToY(10, viewport, 100), 100);
  });

  test("15: yToPrice is the exact inverse of priceToY", () => {
    const price = 14.37;
    const y = priceToY(price, viewport, 100);
    assert.ok(Math.abs(yToPrice(y, viewport, 100) - price) < 1e-9);
  });

  test("16: timeToX places minTime at x=0 and maxTime at the far edge", () => {
    assert.equal(timeToX(0, viewport, 200), 0);
    assert.equal(timeToX(1000, viewport, 200), 200);
  });

  test("17: xToTime is the exact inverse of timeToX", () => {
    const time = 437;
    const x = timeToX(time, viewport, 200);
    assert.ok(Math.abs(xToTime(x, viewport, 200) - time) < 1e-9);
  });

  test("18: a degenerate (zero-width) viewport never divides by zero / produces NaN", () => {
    const flat: Viewport = { minTime: 500, maxTime: 500, minPrice: 10, maxPrice: 10 };
    assert.ok(Number.isFinite(priceToY(10, flat, 100)));
    assert.ok(Number.isFinite(timeToX(500, flat, 200)));
  });

  test("19: zero plot dimensions never divide by zero / produce NaN", () => {
    assert.ok(Number.isFinite(priceToY(15, viewport, 0)));
    assert.ok(Number.isFinite(timeToX(500, viewport, 0)));
  });

  test("20: repeated round-trip conversions do not drift (no floating-point accumulation)", () => {
    let price = 12.5;
    for (let i = 0; i < 1000; i++) {
      const y = priceToY(price, viewport, 100);
      price = yToPrice(y, viewport, 100);
    }
    assert.ok(Math.abs(price - 12.5) < 1e-6);
  });
}

// ============================================================
// 21-32: viewport (Phase 7, pan/zoom/fit)
// ============================================================
function viewportTests(): void {
  test("21: fitToData on an empty series returns a finite, non-fabricated placeholder viewport", () => {
    const vp = fitToData([]);
    assert.ok(Number.isFinite(vp.minTime) && Number.isFinite(vp.maxTime));
    assert.ok(vp.maxTime > vp.minTime);
  });

  test("22: fitToData spans the real candle range", () => {
    const candles = makeSeries(10);
    const vp = fitToData(candles);
    assert.equal(vp.minTime, candles[0].time);
    assert.ok(vp.maxTime > candles[candles.length - 1].time);
  });

  test("23: candleStepMs is derived from real consecutive candle timestamps", () => {
    const candles = makeSeries(5, 60_000);
    assert.equal(candleStepMs(candles), 60_000);
  });

  test("24: candleStepMs falls back to a safe default with fewer than 2 candles (never divides by zero downstream)", () => {
    assert.ok(candleStepMs([]) > 0);
    assert.ok(candleStepMs(makeSeries(1)) > 0);
  });

  test("25: panViewport shifts both bounds by the same delta - span is unchanged", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 10, maxPrice: 20 };
    const panned = panViewport(vp, 500);
    assert.equal(panned.minTime, 500);
    assert.equal(panned.maxTime, 1500);
    assert.equal(panned.maxTime - panned.minTime, vp.maxTime - vp.minTime);
  });

  test("26: zoomViewport with factor < 1 shrinks the visible span (zoom in)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 10, maxPrice: 20 };
    const zoomed = zoomViewport(vp, 0.5, 50_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime < vp.maxTime - vp.minTime);
  });

  test("27: zoomViewport with factor > 1 grows the visible span (zoom out)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 10, maxPrice: 20 };
    const zoomed = zoomViewport(vp, 2, 50_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime > vp.maxTime - vp.minTime);
  });

  test("28: zoomViewport never zooms in past the minimum-visible-candles floor", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 10, maxPrice: 20 };
    let zoomed = vp;
    for (let i = 0; i < 50; i++) zoomed = zoomViewport(zoomed, 0.5, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime >= 1_000 * 5 - 1e-6);
  });

  test("29: zoomViewport never zooms out past the maximum-visible-candles ceiling", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 10, maxPrice: 20 };
    let zoomed = vp;
    for (let i = 0; i < 50; i++) zoomed = zoomViewport(zoomed, 2, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime <= 1_000 * 2000 + 1e-6);
  });

  test("30: priceRangeForWindow auto-fits only the candles inside the given time window", () => {
    const candles = makeSeries(20, 60_000, 100);
    const { maxPrice } = priceRangeForWindow(candles, candles[0].time, candles[4].time);
    const visibleHighs = candles.slice(0, 5).map((c) => c.high);
    assert.ok(maxPrice >= Math.max(...visibleHighs));
  });

  test("31: priceRangeForWindow falls back to the full series when nothing is visible - never a degenerate 0..1 range mid-interaction with real data", () => {
    const candles = makeSeries(5, 60_000, 100);
    const { minPrice, maxPrice } = priceRangeForWindow(candles, -1_000_000, -999_000);
    assert.ok(maxPrice > minPrice);
    assert.notEqual(minPrice, 0);
  });

  test("32: priceRangeForWindow pads a flat (high===low across all visible candles) range so it never collapses to zero height", () => {
    const flatCandles = [chartCandle(0, 100, 100, 100, 100)];
    const { minPrice, maxPrice } = priceRangeForWindow(flatCandles, 0, 0);
    assert.ok(maxPrice > minPrice);
  });
}

// ============================================================
// 33-40: price-axis (Phase 9)
// ============================================================
function priceAxisTests(): void {
  test("33: computePriceTicks returns ticks within the visible price range", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 100, maxPrice: 200 };
    const ticks = computePriceTicks(vp);
    for (const t of ticks) {
      assert.ok(t.price >= vp.minPrice - 1e-6 && t.price <= vp.maxPrice + 1e-6);
    }
  });

  test("34: computePriceTicks returns a non-trivial tick count for a normal range", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 100, maxPrice: 200 };
    assert.ok(computePriceTicks(vp).length >= 2);
  });

  test("35: computePriceTicks returns [] for a degenerate (minPrice >= maxPrice) viewport", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 100, maxPrice: 100 };
    assert.deepEqual(computePriceTicks(vp), []);
  });

  test("36: a small forex-scale range produces multi-decimal ticks", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 1.0800, maxPrice: 1.0850 };
    const ticks = computePriceTicks(vp);
    assert.ok(ticks.some((t) => t.decimals >= 3));
  });

  test("37: a large index-scale range produces zero/low-decimal ticks", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 20000, maxPrice: 25000 };
    const ticks = computePriceTicks(vp);
    assert.ok(ticks.every((t) => t.decimals <= 1));
  });

  test("38: every tick on the axis shares the same decimal precision (column alignment)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 50, maxPrice: 150 };
    const ticks = computePriceTicks(vp);
    const distinctDecimals = new Set(ticks.map((t) => t.decimals));
    assert.ok(distinctDecimals.size <= 1);
  });

  test("39: computePriceTicks is deterministic - identical input always produces identical output", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 33.3, maxPrice: 66.6 };
    assert.deepEqual(computePriceTicks(vp), computePriceTicks(vp));
  });

  test("40: computePriceTicks handles a NaN bound without throwing, returning an honest empty result", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: NaN, maxPrice: 100 };
    assert.deepEqual(computePriceTicks(vp), []);
  });
}

// ============================================================
// 41-48: time-axis (Phase 10, reuses SignalTimeframe)
// ============================================================
function timeAxisTests(): void {
  test("41: intraday timeframes (1m..4h) use 'time' granularity", () => {
    for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h"] as const) {
      assert.equal(timeAxisGranularity(tf), "time");
    }
  });

  test("42: day+ timeframes (1d, 1w) use 'date' granularity", () => {
    assert.equal(timeAxisGranularity("1d"), "date");
    assert.equal(timeAxisGranularity("1w"), "date");
  });

  test("43: every tick's time corresponds to a REAL candle timestamp, never a synthesized one", () => {
    const candles = makeSeries(30, 60_000);
    const vp = fitToData(candles);
    const ticks = computeTimeTicks(candles, vp, "1h");
    const realTimes = new Set(candles.map((c) => c.time));
    for (const t of ticks) assert.ok(realTimes.has(t.time));
  });

  test("44: computeTimeTicks returns [] when nothing is visible in the window", () => {
    const candles = makeSeries(10, 60_000);
    const ticks = computeTimeTicks(candles, { minTime: -1_000_000, maxTime: -999_000, minPrice: 0, maxPrice: 1 }, "1h");
    assert.deepEqual(ticks, []);
  });

  test("45: computeTimeTicks never returns more than the requested target count materially exceeded", () => {
    const candles = makeSeries(500, 60_000);
    const vp = fitToData(candles);
    const ticks = computeTimeTicks(candles, vp, "1h", 6);
    assert.ok(ticks.length <= 12);
  });

  test("46: each tick's index correctly maps back to the candle at that time", () => {
    const candles = makeSeries(20, 60_000);
    const vp = fitToData(candles);
    const ticks = computeTimeTicks(candles, vp, "1h");
    for (const t of ticks) assert.equal(candles[t.index].time, t.time);
  });

  test("47: an empty candle series produces no ticks", () => {
    assert.deepEqual(computeTimeTicks([], fitToData([]), "1h"), []);
  });

  test("48: formatTimestamp('time') and formatTimestamp('date') produce different, non-empty strings for the same instant", () => {
    const ms = Date.parse("2026-08-12T14:30:00Z");
    const time = formatTimestamp(ms, "time");
    const date = formatTimestamp(ms, "date");
    assert.ok(time.length > 0 && date.length > 0 && time !== date);
  });
}

// ============================================================
// 49-52: candle-classifier (Phase 5)
// ============================================================
function candleClassifierTests(): void {
  test("49: close > open classifies bullish", () => {
    assert.equal(classifyCandle(chartCandle(0, 100, 110, 95, 108)), "bullish");
  });

  test("50: close < open classifies bearish", () => {
    assert.equal(classifyCandle(chartCandle(0, 108, 110, 95, 100)), "bearish");
  });

  test("51: a near-equal open/close relative to the full range classifies doji", () => {
    assert.equal(classifyCandle(chartCandle(0, 100, 110, 90, 100.1)), "doji");
  });

  test("52: a zero-range candle (high===low) classifies doji without dividing by zero", () => {
    assert.equal(classifyCandle(chartCandle(0, 100, 100, 100, 100)), "doji");
  });
}

// ============================================================
// 53-56: crosshair (Phase 8)
// ============================================================
function crosshairTests(): void {
  test("53: nearestCandleIndex snaps to the real candle closest to the cursor position", () => {
    const candles = makeSeries(10, 60_000);
    const vp = fitToData(candles);
    const x = timeToX(candles[3].time, vp, 1000);
    assert.equal(nearestCandleIndex(candles, vp, x, 1000), 3);
  });

  test("54: nearestCandleIndex returns -1 for an empty series", () => {
    assert.equal(nearestCandleIndex([], { minTime: 0, maxTime: 100, minPrice: 0, maxPrice: 1 }, 50, 100), -1);
  });

  test("55: nearestCandleIndex never fabricates an interpolated candle between two real ones - it always returns a real index", () => {
    const candles = makeSeries(5, 60_000);
    const vp = fitToData(candles);
    const index = nearestCandleIndex(candles, vp, 1, 1000);
    assert.ok(Number.isInteger(index) && index >= 0 && index < candles.length);
  });

  test("56: nearestCandleIndex is deterministic for identical inputs", () => {
    const candles = makeSeries(8, 60_000);
    const vp = fitToData(candles);
    assert.equal(nearestCandleIndex(candles, vp, 250, 1000), nearestCandleIndex(candles, vp, 250, 1000));
  });
}

// ============================================================
// 57-60: canvas typography/color resolution (D2.7.1 contract bridge)
// ============================================================
function canvasTypographyAndColorTests(): void {
  test("57: resolveMonoFontFamily returns a safe monospace fallback outside a browser (no `document` in this script's environment)", () => {
    const family = resolveMonoFontFamily();
    assert.ok(family.toLowerCase().includes("mono"));
  });

  test("58: canvasMonoFont composes a valid Canvas 2D font string", () => {
    assert.match(canvasMonoFont(12), /^12px .+/);
  });

  test("59: resolveChartColors falls back to AT24's real documented token hex values outside a browser", () => {
    const colors = resolveChartColors();
    assert.equal(colors.bullish, "#3fb27f"); // --signal-up
    assert.equal(colors.bearish, "#d1594a"); // --signal-down
    assert.equal(colors.gold, "#d4af37"); // --gold
  });

  test("60: chart-typography-contract.ts's pre-declared 'timestamp' formatter now has a real implementation (D2.7.1's own forward declaration, fulfilled by this sprint)", () => {
    const contractSrc = read("types/chart-typography-contract.ts");
    assert.ok(contractSrc.includes('"timestamp"'));
    assert.equal(typeof formatTimestamp, "function");
  });
}

// ============================================================
// 61-64: renderer (end-to-end draw against a recording fake ctx)
// ============================================================
function rendererTests(): void {
  function fakeCtx(): CanvasRenderingContext2D {
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
    return ctx as unknown as CanvasRenderingContext2D;
  }

  test("61: renderChart runs end-to-end on a real candle series without throwing", () => {
    const candles = makeSeries(50, 60_000);
    const vp = fitToData(candles);
    const ctx = fakeCtx();
    renderChart({
      ctx,
      dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport: vp,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
    });
    assert.ok((ctx as unknown as { calls: string[] }).calls.includes("fillRect"));
  });

  test("62: renderChart with a crosshair present draws without throwing", () => {
    const candles = makeSeries(20, 60_000);
    const vp = fitToData(candles);
    const ctx = fakeCtx();
    renderChart({
      ctx,
      dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport: vp,
      timeframe: "1h",
      crosshair: { index: 3, x: 50, y: 40 },
      colors: resolveChartColors(),
    });
    assert.ok((ctx as unknown as { calls: string[] }).calls.includes("fillText"));
  });

  test("63: renderChart on an empty candle series never throws (honest empty-plot draw)", () => {
    const ctx = fakeCtx();
    assert.doesNotThrow(() => {
      renderChart({
        ctx,
        dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles: [],
        viewport: fitToData([]),
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });

  test("64: renderChart on a zero-size canvas never throws (dimension clamp before drawing)", () => {
    const candles = makeSeries(5, 60_000);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => {
      renderChart({
        ctx,
        dims: { width: 0, height: 0, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport: fitToData(candles),
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });
}

// ============================================================
// 65-68: SignalTimeframe reuse (Phase 10's "no second timeframe registry")
// ============================================================
function timeframeReuseTests(): void {
  test("65: isSignalTimeframe accepts every real SignalTimeframe value", () => {
    for (const tf of SIGNAL_TIMEFRAMES) assert.ok(isSignalTimeframe(tf));
  });

  test("66: isSignalTimeframe rejects an unknown string", () => {
    assert.equal(isSignalTimeframe("2h"), false);
    assert.equal(isSignalTimeframe("daily"), false);
  });

  test("67: isSignalTimeframe rejects a non-string value without throwing", () => {
    assert.equal(isSignalTimeframe(null), false);
    assert.equal(isSignalTimeframe(42), false);
  });

  test("68: the candles route reuses the EXISTING PROVIDER_INTERVAL registry - it never declares a second timeframe-to-interval map", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("PROVIDER_INTERVAL"));
    assert.ok(src.includes("hypothesis-outcome-evaluator.service"));
    assert.ok(!/const\s+PROVIDER_INTERVAL/.test(src));
  });
}

// ============================================================
// 69-76: structural / regression / no-fabrication guards
// ============================================================
function regressionGuardTests(): void {
  test("69: the candles route requires authentication before returning any data", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("getUserOrNull"));
    assert.ok(src.includes("UNAUTHORIZED"));
  });

  test("70: the candles route consumes the EXISTING MarketDataService singleton - it never instantiates a provider directly", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("shared-instance"));
    assert.ok(!src.includes("new TwelveDataProvider"));
    assert.ok(!src.includes("new BinanceProvider"));
    assert.ok(!src.includes("new AngelOneProvider"));
    assert.ok(!src.includes("new AlphaVantageProvider"));
  });

  test("71: the candles route validates the symbol against the EXISTING canonical instrument catalog - never a second symbol registry", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("getCanonicalInstrument"));
  });

  test("72: market-data.service.ts was not modified by this sprint (Phase 1's 'do not duplicate the market-data service')", () => {
    const src = read("services/market-data/market-data.service.ts");
    assert.ok(!src.includes("chart-engine"));
    assert.ok(!src.includes("ChartCandle"));
  });

  test("73: chart-instrument-resolver.ts (the TradingView symbol layer) is untouched by this sprint - NativeChart consumes it, never duplicates it", () => {
    const resolverSrc = read("lib/market-data/chart-instrument-resolver.ts");
    assert.ok(resolverSrc.includes("Sprint D2.6.11") || resolverSrc.includes("Sprint D2.6.12"));
    const nativeChartSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(nativeChartSrc.includes("resolveChartInstrument"));
  });

  test("74: AdvancedChart.tsx (TradingView) still exists and is not deleted - the native engine coexists, never replaces it", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(src.includes("export default function AdvancedChart"));
  });

  test("75: ChartPanel renders an explicit native/tradingview boundary - neither is a silent fallback for the other", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes('"native"'));
    assert.ok(src.includes("AdvancedChart"));
    assert.ok(src.includes("NativeChart"));
  });

  test("76: the Workspace page wires ChartPanel into the existing Chart section - it does not add a second, competing chart section", () => {
    const src = read("app/dashboard/workspace/page.tsx");
    const chartPanelOccurrences = (src.match(/ChartPanel/g) ?? []).length;
    assert.ok(chartPanelOccurrences >= 2); // import + usage
    assert.ok(!src.includes("<AdvancedChart"));
  });
}

// ============================================================
// 77-80: no-fabrication / honesty guards specific to this sprint
// ============================================================
function noFabricationTests(): void {
  test("77: normalizeCandles never invents a value for a rejected candle - rejected candles are absent from the output, not zero-filled", () => {
    const raw = [rawCandle("2026-01-01T00:00:00Z", NaN, NaN, NaN, NaN)];
    const { candles } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
  });

  test("78: ChartSeries reports rejectedCount honestly - NativeChart.tsx surfaces it to the user rather than hiding it", () => {
    const nativeChartSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(nativeChartSrc.includes("rejectedCount"));
  });

  test("79: NativeChart never falls back to a different symbol - an unsupported instrument renders an honest message, not another chart", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("resolution.supported"));
    assert.ok(src.includes("Chart visualization is unavailable"));
  });

  test("80: useChartCandles never fabricates a series on a fetch failure - it reports an honest error/unsupported status", () => {
    const src = read("components/chart-engine/useChartCandles.ts");
    assert.ok(src.includes('"error"'));
    assert.ok(src.includes('"unsupported"'));
    assert.ok(!/candles:\s*\[\]\s*,\s*status:\s*"ready"/.test(src));
  });
}

async function main(): Promise<void> {
  candleNormalizerTests();
  coordinateSystemTests();
  viewportTests();
  priceAxisTests();
  timeAxisTests();
  candleClassifierTests();
  crosshairTests();
  canvasTypographyAndColorTests();
  rendererTests();
  timeframeReuseTests();
  regressionGuardTests();
  noFabricationTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
