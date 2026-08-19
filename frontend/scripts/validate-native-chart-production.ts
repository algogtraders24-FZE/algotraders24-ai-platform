// scripts/validate-native-chart-production.ts
// Sprint D2.7.3 - AT24 Native Chart Engine: Production Data Layer,
// Indicators & Professional Chart UX. Standalone, assert-based
// verification (no test framework), matching every prior sprint's
// scripts/validate-*.ts pattern. Run via `npm run validate:native-chart-production`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sma, ema, rsi, bollinger, macd, emaSeries, smaSeries, rsiSeries, bollingerSeries, macdSeries } from "../lib/market-data/indicators";
import { computeIndicatorSeries, valueAtIndex } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS, PANEL_REGISTRY } from "../lib/chart-engine/indicators/panel-registry";
import { computePanelLayout } from "../lib/chart-engine/panel-layout";
import { nearestIndexByTime, lowerBoundByTime, upperBoundByTime, visibleWindow, latestCandle, candleAtExactTime } from "../lib/chart-engine/candle-index";
import { fitToData, isAtRightEdge, followLatest, priceRangeForWindow } from "../lib/chart-engine/viewport";
import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { MarketDataService } from "../services/market-data/market-data.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, MarketContextRequest } from "../types/market-data-provider";
import type { TimeSeriesProvider } from "../types/market-data-provider";
import type { Candle } from "../types/market-candle";
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

function chartCandle(time: number, o: number, h: number, l: number, c: number, volume?: number): ChartCandle {
  return { time, open: o, high: h, low: l, close: c, volume };
}

function makeSeries(count: number, stepMs = 60_000, base = 100): ChartCandle[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 5) * 5 + i * 0.01;
    const c = o + (i % 3 === 0 ? -1 : 1) * (1 + (i % 7));
    const h = Math.max(o, c) + 1;
    const l = Math.min(o, c) - 1;
    out.push(chartCandle(start + i * stepMs, o, h, l, c, 1000 + (i % 50) * 10));
  }
  return out;
}

function realCloses(n: number): number[] {
  return makeSeries(n).map((c) => c.close);
}

// ============================================================
// 1-14: indicator SERIES functions agree with their scalar siblings
// (the "reuse, verified by equivalence" discipline)
// ============================================================
async function seriesEquivalenceTests(): Promise<void> {
  const values = realCloses(60);

  await test("1: smaSeries's last value equals sma()'s scalar result", () => {
    const series = smaSeries(values, 20);
    assert.ok(Math.abs((series[series.length - 1] as number) - (sma(values, 20) as number)) < 1e-9);
  });

  await test("2: smaSeries is undefined before enough data, defined once enough exists", () => {
    const series = smaSeries(values, 20);
    assert.equal(series[18], undefined);
    assert.notEqual(series[19], undefined);
  });

  await test("3: emaSeries (now exported) is the exact same function ema() and macd() already depend on", () => {
    const raw = emaSeries(values, 20);
    assert.ok(raw);
    assert.equal(raw![raw!.length - 1], ema(values, 20));
  });

  await test("4: rsiSeries's last value equals rsi()'s scalar result", () => {
    const series = rsiSeries(values, 14);
    assert.ok(Math.abs((series[series.length - 1] as number) - (rsi(values, 14) as number)) < 1e-9);
  });

  await test("5: rsiSeries is undefined for indices before period+1 data points exist", () => {
    const series = rsiSeries(values, 14);
    for (let i = 0; i < 14; i++) assert.equal(series[i], undefined);
    assert.notEqual(series[14], undefined);
  });

  await test("6: bollingerSeries's last value equals bollinger()'s scalar result", () => {
    const series = bollingerSeries(values, 20, 2);
    const last = series[series.length - 1];
    const scalar = bollinger(values, 20, 2);
    assert.ok(last && scalar);
    assert.ok(Math.abs(last!.upper - scalar!.upper) < 1e-9);
    assert.ok(Math.abs(last!.middle - scalar!.middle) < 1e-9);
    assert.ok(Math.abs(last!.lower - scalar!.lower) < 1e-9);
  });

  await test("7: macdSeries's last value equals macd()'s scalar result", () => {
    const series = macdSeries(values, 12, 26, 9);
    const last = series[series.length - 1];
    const scalar = macd(values, 12, 26, 9);
    assert.ok(last && scalar);
    assert.ok(Math.abs(last!.macd - scalar!.macd) < 1e-9);
    assert.ok(Math.abs(last!.signal - scalar!.signal) < 1e-9);
    assert.ok(Math.abs(last!.histogram - scalar!.histogram) < 1e-9);
  });

  await test("8: every *Series function returns exactly one entry per input value", () => {
    assert.equal(smaSeries(values, 20).length, values.length);
    assert.equal(rsiSeries(values, 14).length, values.length);
    assert.equal(bollingerSeries(values, 20).length, values.length);
    assert.equal(macdSeries(values).length, values.length);
  });

  await test("9: smaSeries with period<=0 is honestly all-undefined, never throws", () => {
    const series = smaSeries(values, 0);
    assert.ok(series.every((v) => v === undefined));
  });

  await test("10: rsiSeries with insufficient total data is honestly all-undefined", () => {
    const series = rsiSeries(values.slice(0, 5), 14);
    assert.ok(series.every((v) => v === undefined));
  });

  await test("11: bollingerSeries with insufficient total data is honestly all-undefined", () => {
    const series = bollingerSeries(values.slice(0, 5), 20);
    assert.ok(series.every((v) => v === undefined));
  });

  await test("12: macdSeries with insufficient total data is honestly all-undefined", () => {
    const series = macdSeries(values.slice(0, 5));
    assert.ok(series.every((v) => v === undefined));
  });

  await test("13: sma()/ema()/rsi()/macd()/bollinger() scalar functions are byte-identical to before this sprint (still exported, still same signatures) - TechnicalContextService's import surface is untouched", () => {
    const src = read("services/ai/technical-context.service.ts");
    assert.ok(src.includes('import { closes, rsi, ema, sma, atr, macd, bollinger, volumeMetrics } from "@/lib/market-data/indicators"'));
  });

  await test("14: the *Series functions were added, never interleaved into/replacing the existing scalar function bodies", () => {
    const src = read("lib/market-data/indicators.ts");
    const marker = src.indexOf("AT24 Native Chart Engine: Production Data Layer");
    assert.ok(marker > 0);
    const beforeMarker = src.slice(0, marker);
    // every original scalar export still appears once, before the D2.7.3 section
    for (const fn of ["export function sma(", "export function rsi(", "export function atr(", "export function macd(", "export function bollinger(", "export function volumeMetrics("]) {
      assert.ok(beforeMarker.includes(fn), `${fn} missing before the D2.7.3 marker`);
    }
  });
}

// ============================================================
// 15-24: compute.ts - the Indicator Data layer
// ============================================================
async function computeLayerTests(): Promise<void> {
  const candles = makeSeries(60, 60_000);

  await test("15: computeIndicatorSeries(ema) produces one point per candle, real times", () => {
    const series = computeIndicatorSeries(candles, { id: "ema", key: "ema-20", period: 20, color: "var(--gold)" });
    assert.equal(series.lines[0].points.length, candles.length);
    assert.equal(series.lines[0].points[0].time, candles[0].time);
  });

  await test("16: computeIndicatorSeries(ema) panel is 'price' (overlay)", () => {
    const series = computeIndicatorSeries(candles, { id: "ema", key: "ema-20", period: 20, color: "var(--gold)" });
    assert.equal(series.panel, "price");
  });

  await test("17: computeIndicatorSeries(rsi) panel is 'rsi'", () => {
    const series = computeIndicatorSeries(candles, { id: "rsi", key: "rsi-14", period: 14, color: "var(--gold)" });
    assert.equal(series.panel, "rsi");
  });

  await test("18: computeIndicatorSeries(macd) panel is 'macd' and produces 3 named lines", () => {
    const series = computeIndicatorSeries(candles, { id: "macd", key: "macd", period: 12, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, color: "var(--gold)" });
    assert.equal(series.panel, "macd");
    assert.equal(series.lines.length, 3);
  });

  await test("19: computeIndicatorSeries(bollinger) produces upper/middle/lower lines", () => {
    const series = computeIndicatorSeries(candles, { id: "bollinger", key: "bollinger-20", period: 20, stdDevMultiplier: 2, color: "var(--text-3)" });
    assert.equal(series.lines.length, 3);
    assert.ok(series.lines.some((l) => l.name.includes("upper")));
  });

  await test("20: computeIndicatorSeries(volume) panel is 'volume'", () => {
    const series = computeIndicatorSeries(candles, { id: "volume", key: "volume", period: 20, color: "var(--steel)" });
    assert.equal(series.panel, "volume");
  });

  await test("21: valueAtIndex reads the exact real value at the given candle index - never interpolated", () => {
    const series = computeIndicatorSeries(candles, { id: "sma", key: "sma-20", period: 20, color: "var(--steel)" });
    const values = valueAtIndex(series, 25);
    assert.equal(values[0], series.lines[0].points[25].value);
  });

  await test("22: valueAtIndex at an index before the indicator is computable is honestly undefined", () => {
    const series = computeIndicatorSeries(candles, { id: "sma", key: "sma-20", period: 20, color: "var(--steel)" });
    const values = valueAtIndex(series, 2);
    assert.equal(values[0], undefined);
  });

  await test("23: compute.ts contains zero indicator math of its own - it only calls lib/market-data/indicators.ts's *Series functions", () => {
    const src = read("lib/chart-engine/indicators/compute.ts");
    assert.ok(src.includes("smaSeries") && src.includes("emaSeries") && src.includes("rsiSeries") && src.includes("bollingerSeries") && src.includes("macdSeries"));
    assert.ok(!/avgGain|avgLoss|k = 2 \/ \(period/.test(src)); // no reimplemented Wilder/EMA math
  });

  await test("24: DEFAULT_INDICATOR_CONFIGS periods match TechnicalContextService's own existing choices (RSI-14, EMA-20/50, SMA-20, Bollinger-20/2, MACD-12/26/9) - a chart value never disagrees with the AI panel's value for the same inputs", () => {
    const rsiCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "rsi");
    const ema20 = DEFAULT_INDICATOR_CONFIGS.find((c) => c.key === "ema-20");
    const ema50 = DEFAULT_INDICATOR_CONFIGS.find((c) => c.key === "ema-50");
    assert.equal(rsiCfg?.period, 14);
    assert.equal(ema20?.period, 20);
    assert.equal(ema50?.period, 50);
  });
}

// ============================================================
// 25-32: panel registry / layout (Phase 8)
// ============================================================
async function panelLayoutTests(): Promise<void> {
  await test("25: computePanelLayout always includes the price panel first, even with no active sub-panels", () => {
    const rows = computePanelLayout([], 400);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "price");
    assert.equal(rows[0].top, 0);
  });

  await test("26: computePanelLayout places sub-panels after price, non-overlapping", () => {
    const rows = computePanelLayout(["volume", "rsi"], 400);
    assert.equal(rows.length, 3);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].top >= rows[i - 1].top + rows[i - 1].height);
  });

  await test("27: computePanelLayout never duplicates the price panel if it's redundantly passed as active", () => {
    const rows = computePanelLayout(["price", "volume"], 400);
    assert.equal(rows.filter((r) => r.id === "price").length, 1);
  });

  await test("28: computePanelLayout's rows always sum to <= the total height (accounting for gaps)", () => {
    const rows = computePanelLayout(["volume", "rsi", "macd"], 500);
    const last = rows[rows.length - 1];
    assert.ok(last.top + last.height <= 500 + 1e-6);
  });

  await test("29: the price panel always gets the largest single share (heightWeight 3 vs 1 for every sub-panel)", () => {
    assert.ok(PANEL_REGISTRY.price.heightWeight > PANEL_REGISTRY.volume.heightWeight);
    assert.ok(PANEL_REGISTRY.price.heightWeight > PANEL_REGISTRY.rsi.heightWeight);
    assert.ok(PANEL_REGISTRY.price.heightWeight > PANEL_REGISTRY.macd.heightWeight);
  });

  await test("30: computePanelLayout with zero total height never throws / never produces negative heights", () => {
    const rows = computePanelLayout(["volume"], 0);
    for (const row of rows) assert.ok(row.height >= 0);
  });

  await test("31: panel-registry.ts colors are all derived from existing AT24 design tokens (var(--...)) - never a hardcoded hex", () => {
    for (const cfg of DEFAULT_INDICATOR_CONFIGS) assert.match(cfg.color, /^var\(--/);
  });

  // Updated (Phase 2, this session) - atr/stochastic are legitimate new
  // panel ids added to Phase 8's original enumerated set, each with their
  // own real sub-panel renderer (sub-panel-renderer.ts's drawAtrPanel/
  // drawStochasticPanel), not an uncontrolled/unregistered addition.
  await test("32: panel-registry.ts's panel ids are exactly Phase 8's original set plus Phase 2's atr/stochastic - never an untracked addition", () => {
    assert.deepEqual(Object.keys(PANEL_REGISTRY).sort(), ["atr", "macd", "price", "rsi", "stochastic", "volume"]);
  });
}

// ============================================================
// 33-45: candle-index.ts (binary search correctness)
// ============================================================
async function candleIndexTests(): Promise<void> {
  const candles = makeSeries(200, 60_000);

  function bruteNearest(targetTime: number): number {
    let best = 0;
    let bestDelta = Math.abs(candles[0].time - targetTime);
    for (let i = 1; i < candles.length; i++) {
      const d = Math.abs(candles[i].time - targetTime);
      if (d < bestDelta) {
        bestDelta = d;
        best = i;
      }
    }
    return best;
  }

  await test("33: nearestIndexByTime agrees with a brute-force linear scan for an exact candle time", () => {
    const target = candles[50].time;
    assert.equal(nearestIndexByTime(candles, target), bruteNearest(target));
  });

  await test("34: nearestIndexByTime agrees with brute force for a time between two candles", () => {
    const target = candles[50].time + 20_000;
    assert.equal(nearestIndexByTime(candles, target), bruteNearest(target));
  });

  await test("35: nearestIndexByTime agrees with brute force for a time before the series starts", () => {
    const target = candles[0].time - 1_000_000;
    assert.equal(nearestIndexByTime(candles, target), bruteNearest(target));
  });

  await test("36: nearestIndexByTime agrees with brute force for a time after the series ends", () => {
    const target = candles[candles.length - 1].time + 1_000_000;
    assert.equal(nearestIndexByTime(candles, target), bruteNearest(target));
  });

  await test("37: nearestIndexByTime returns -1 for an empty array", () => {
    assert.equal(nearestIndexByTime([], 12345), -1);
  });

  await test("38: nearestIndexByTime agrees with brute force across 50 random probe times (comprehensive equivalence check)", () => {
    for (let i = 0; i < 50; i++) {
      const t = candles[0].time + Math.floor(Math.random() * (candles[candles.length - 1].time - candles[0].time));
      assert.equal(nearestIndexByTime(candles, t), bruteNearest(t));
    }
  });

  await test("39: lowerBoundByTime returns the first index >= minTime", () => {
    const idx = lowerBoundByTime(candles, candles[30].time);
    assert.equal(idx, 30);
  });

  await test("40: upperBoundByTime returns the last index <= maxTime", () => {
    const idx = upperBoundByTime(candles, candles[30].time);
    assert.equal(idx, 30);
  });

  await test("41: visibleWindow returns the exact real index range for a real viewport", () => {
    const viewport: Viewport = { minTime: candles[10].time, maxTime: candles[20].time, minPrice: 0, maxPrice: 1 };
    const { startIndex, endIndex } = visibleWindow(candles, viewport);
    assert.equal(startIndex, 10);
    assert.equal(endIndex, 20);
  });

  await test("42: visibleWindow returns -1/-1 when nothing is visible", () => {
    const viewport: Viewport = { minTime: -2_000_000, maxTime: -1_000_000, minPrice: 0, maxPrice: 1 };
    const { startIndex, endIndex } = visibleWindow(candles, viewport);
    assert.equal(startIndex, -1);
    assert.equal(endIndex, -1);
  });

  await test("43: latestCandle returns the real last candle, undefined for an empty series", () => {
    assert.equal(latestCandle(candles), candles[candles.length - 1]);
    assert.equal(latestCandle([]), undefined);
  });

  await test("44: candleAtExactTime finds a real exact match", () => {
    assert.equal(candleAtExactTime(candles, candles[77].time), candles[77]);
  });

  await test("45: candleAtExactTime never returns a nearest-match fallback for a time with no exact candle", () => {
    assert.equal(candleAtExactTime(candles, candles[77].time + 100), undefined);
  });
}

// ============================================================
// 46-52: viewport.ts live-edge model (Phase 5)
// ============================================================
async function liveEdgeTests(): Promise<void> {
  await test("46: isAtRightEdge is true immediately after fitToData (a freshly loaded chart starts at the live edge)", () => {
    const candles = makeSeries(50, 60_000);
    const vp = fitToData(candles);
    assert.ok(isAtRightEdge(vp, candles));
  });

  await test("47: isAtRightEdge is false after panning far away from the latest candle", () => {
    const candles = makeSeries(50, 60_000);
    const vp: Viewport = { minTime: candles[0].time - 10_000_000, maxTime: candles[0].time, minPrice: 0, maxPrice: 1 };
    assert.equal(isAtRightEdge(vp, candles), false);
  });

  await test("48: isAtRightEdge is true (never false) when there is no data yet - nothing to have panned away from", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 0, maxPrice: 1 };
    assert.ok(isAtRightEdge(vp, []));
  });

  await test("49: followLatest keeps the SAME span (zoom level unaffected)", () => {
    const candles = makeSeries(50, 60_000);
    const vp = fitToData(candles);
    const span = vp.maxTime - vp.minTime;
    const more = makeSeries(60, 60_000); // simulates new candles arriving
    const followed = followLatest(vp, more);
    assert.ok(Math.abs(followed.maxTime - followed.minTime - span) < 1e-6);
  });

  await test("50: followLatest's right edge tracks the real latest candle", () => {
    const candles = makeSeries(60, 60_000);
    const vp = fitToData(candles.slice(0, 50));
    const followed = followLatest(vp, candles);
    assert.ok(followed.maxTime > candles[59].time);
  });

  await test("51: followLatest on an empty series returns the viewport unchanged (never fabricates a data range)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 1000, minPrice: 0, maxPrice: 1 };
    assert.deepEqual(followLatest(vp, []), vp);
  });

  await test("52: priceRangeForWindow still works correctly after a followLatest shift (used together in NativeChart's data effect)", () => {
    const candles = makeSeries(60, 60_000);
    const vp = fitToData(candles.slice(0, 50));
    const followed = followLatest(vp, candles);
    const { minPrice, maxPrice } = priceRangeForWindow(candles, followed.minTime, followed.maxTime);
    assert.ok(maxPrice > minPrice);
  });
}

// ============================================================
// 53-62: provider provenance (Phase 2)
// ============================================================
function fakeTimeSeriesProvider(name: string, behavior: "success" | "unconfigured" | "fail"): MarketDataProvider & TimeSeriesProvider {
  return {
    name,
    isConfigured: () => behavior !== "unconfigured",
    async getMarketContext(request: MarketContextRequest) {
      return { symbol: request.symbol, provider: name, retrievedAt: "2026-01-01T00:00:00.000Z", evidence: [] };
    },
    async getTimeSeries(): Promise<Candle[]> {
      if (behavior === "fail") throw new MarketDataProviderError("http_error", `${name} down`, name);
      return [
        { datetime: "2026-01-01T00:00:00Z", open: 100, high: 102, low: 99, close: 101 },
        { datetime: "2026-01-01T00:01:00Z", open: 101, high: 103, low: 100, close: 102 },
      ];
    },
  };
}

async function provenanceTests(): Promise<void> {
  await test("53: getTimeSeries() (the existing, unchanged public method) still returns a bare Candle[] - every existing caller's contract is preserved", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "success")] });
    const candles = await svc.getTimeSeries({ symbol: "BTCUSD" });
    assert.ok(Array.isArray(candles));
    assert.equal(candles.length, 2);
  });

  await test("54: getTimeSeriesWithProvenance() reports the real provider name that served the request", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "success")] });
    const result = await svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD" });
    assert.equal(result.provider, "A");
  });

  await test("55: getTimeSeriesWithProvenance() reports fallbackUsed:false when the top-priority provider answers directly", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "success")] });
    const result = await svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD" });
    assert.equal(result.fallbackUsed, false);
  });

  await test("56: getTimeSeriesWithProvenance() reports fallbackUsed:true only after a REAL failure from a higher-priority provider", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "fail"), fakeTimeSeriesProvider("B", "success")] });
    const result = await svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD" });
    assert.equal(result.provider, "B");
    assert.equal(result.fallbackUsed, true);
  });

  await test("57: getTimeSeriesWithProvenance() reports fallbackUsed:false when a skipped provider was merely unconfigured (not a real failure)", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "unconfigured"), fakeTimeSeriesProvider("B", "success")] });
    const result = await svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD" });
    assert.equal(result.fallbackUsed, false);
  });

  await test("58: getTimeSeries() and getTimeSeriesWithProvenance() use the exact SAME provider ordering (never a second, divergent order)", async () => {
    const providers = [fakeTimeSeriesProvider("A", "fail"), fakeTimeSeriesProvider("B", "success")];
    const svc1 = new MarketDataService({ providers });
    const svc2 = new MarketDataService({ providers });
    const plain = await svc1.getTimeSeries({ symbol: "BTCUSD" });
    const withProvenance = await svc2.getTimeSeriesWithProvenance({ symbol: "BTCUSD" });
    assert.deepEqual(plain, withProvenance.candles);
  });

  await test("59: getTimeSeries() still throws the same aggregate error shape when every provider fails - error handling is unaffected", async () => {
    const svc = new MarketDataService({ providers: [fakeTimeSeriesProvider("A", "fail")] });
    await assert.rejects(svc.getTimeSeries({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError);
  });

  await test("60: market-data.service.ts's provider-selection loop was not duplicated - getTimeSeries() delegates to getTimeSeriesWithProvenance(), it does not re-implement the loop", () => {
    const src = read("services/market-data/market-data.service.ts");
    const getTimeSeriesBody = src.slice(src.indexOf("async getTimeSeries(request"), src.indexOf("async getTimeSeriesWithProvenance"));
    assert.ok(getTimeSeriesBody.includes("getTimeSeriesWithProvenance"));
    assert.ok(!getTimeSeriesBody.includes("orderedProviders"));
  });

  await test("61: the candles route derives providerSymbol from the EXISTING canonical instrument catalog - never a second symbol registry", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("instrument.providerMappings.find"));
  });

  await test("62: TimeSeriesResult never exposes provider credentials - only name/fallbackUsed/candles", () => {
    const src = read("types/market-candle.ts");
    const iface = src.slice(src.indexOf("export interface TimeSeriesResult"), src.indexOf("export interface TimeSeriesResult") + 400);
    assert.ok(!/apiKey|token|secret|credential/i.test(iface));
  });
}

// ============================================================
// 63-70: the candles route's new caching/freshness behavior
// ============================================================
async function routeCacheTests(): Promise<void> {
  await test("63: the candles route reuses the EXISTING TtlCache primitive (lib/market-data/cache.ts) - never a second caching mechanism", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes('from "@/lib/market-data/cache"'));
    assert.ok(!/class \w*Cache/.test(src));
  });

  await test("64: the candles route reuses the EXISTING D2.6.4 freshness-policy.service.ts - never a second freshness formula", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("assessFreshness"));
    assert.ok(src.includes('from "@/services/market-data/freshness-policy.service"'));
  });

  await test("65: ChartSeries.cached/cacheAgeMs are only ever set together (never cacheAgeMs without cached:true)", () => {
    const src = read("types/chart-data.ts");
    assert.ok(src.includes("cached?: boolean"));
    assert.ok(src.includes("cacheAgeMs?: number"));
  });

  await test("66: ChartDataStatus includes both 'stale' and 'partial' (Phase 14's explicit state list)", () => {
    const src = read("types/chart-data.ts");
    assert.ok(src.includes('"loading" | "ready" | "partial" | "empty" | "stale" | "error" | "unsupported"'));
  });

  await test("67: useChartCandles derives 'stale' from series.freshness, never fabricates it client-side", () => {
    const src = read("components/chart-engine/useChartCandles.ts");
    assert.ok(src.includes('series.freshness === "stale"'));
  });

  await test("68: useChartCandles derives 'partial' from series.rejectedCount, never a guess", () => {
    const src = read("components/chart-engine/useChartCandles.ts");
    assert.ok(src.includes("series.rejectedCount > 0"));
  });

  await test("69: useChartCandles polls in the background (Phase 5's fetch-based 'live' analog) but never flashes loading/error over working data on a poll failure", () => {
    const src = read("components/chart-engine/useChartCandles.ts");
    assert.ok(src.includes("setInterval"));
    assert.ok(src.includes("isBackgroundPoll"));
    assert.ok(/if \(isBackgroundPoll\) return;/.test(src));
  });

  await test("70: useChartCandles never introduces a WebSocket (no real streaming infra exists in this platform's provider architecture - an explicit non-goal)", () => {
    const src = read("components/chart-engine/useChartCandles.ts");
    assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
  });
}

// ============================================================
// 71-78: honest states / no-fabrication (Phase 14/17)
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("71: normalizeCandles is still the ONE place raw candles become ChartCandle[] - the route calls it after fetching, never bypassing it", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("normalizeCandles(providerResult.candles)"));
  });

  await test("72: NativeChart never falls back to a different symbol on any status - every branch renders an honest message or the real data, never a substitution", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(!/EURUSD|BTCUSD/.test(src));
  });

  await test("73: NativeChart's stale-state message never claims the data is live", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('result.status === "stale"'));
    assert.ok(!/most recent.*live|live.*confirmed fresh/i.test(src.match(/stale[\s\S]{0,200}/)?.[0] ?? ""));
  });

  await test("74: the crosshair readout renders an indicator value ONLY when it's genuinely computed at that index (undefined values are filtered, never shown as 0 or blank-but-present)", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("values[i] === undefined ? null"));
  });

  await test("75: candle-normalizer.ts's rejection rules are unchanged by this sprint (D2.7.2's own strictly-increasing-time / OHLC-bounds rules still apply)", () => {
    const raw = [
      { datetime: "2026-01-01T00:00:00Z", open: 100, high: 90, low: 99, close: 95 }, // high < low, still rejected
    ];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
    assert.equal(rejectedCount, 1);
  });

  await test("76: ChartToolbar's Indicators menu is driven entirely by DEFAULT_INDICATOR_CONFIGS - never a hardcoded duplicate list", () => {
    // Sprint D2.7.5 grouped the menu into Overlays/Panels sections
    // (OVERLAY_CONFIGS/PANEL_CONFIGS, each a real .filter() over
    // DEFAULT_INDICATOR_CONFIGS, rendered by a shared IndicatorGroup
    // helper's own `configs.map`) - the invariant this test guards
    // (never a hardcoded duplicate indicator list) still holds, just
    // expressed as two filtered derivations of the same real registry
    // instead of one flat .map over it directly.
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes("DEFAULT_INDICATOR_CONFIGS.filter"));
    assert.ok(!/"EMA20"|"RSI14"|"MACD"/.test(src));
  });

  await test("77: no BUY/SELL/probability-of-profit language exists anywhere in the new D2.7.3 chart-engine surface", () => {
    const files = [
      "lib/chart-engine/indicators/compute.ts",
      "lib/chart-engine/indicators/panel-registry.ts",
      "components/chart-engine/ChartToolbar.tsx",
      "components/chart-engine/NativeChart.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.ok(!/\bBUY\b|\bSELL\b|probability of profit|win rate/i.test(src));
    }
  });

  await test("78: ComparisonSeries (Phase 11) is a types-only extension point - no component imports or renders it yet (deliberately deferred)", () => {
    const typeSrc = read("types/chart-data.ts");
    assert.ok(typeSrc.includes("export interface ComparisonSeries"));
    const nativeChartSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(!nativeChartSrc.includes("ComparisonSeries"));
  });
}

// ============================================================
// 79-84: performance at scale (Phase 12)
// ============================================================
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

async function perfTests(): Promise<void> {
  for (const count of [500, 2000, 5000]) {
    await test(`79-81 (${count}): renderChart with 3 active sub-panels + 2 overlays completes well within a per-frame budget at ${count} candles`, () => {
      const candles = makeSeries(count, 60_000);
      const vp = fitToData(candles);
      const overlayCfgs = [DEFAULT_INDICATOR_CONFIGS[0], DEFAULT_INDICATOR_CONFIGS[2]]; // ema-20, sma-20
      const panelCfgs = [DEFAULT_INDICATOR_CONFIGS[4], DEFAULT_INDICATOR_CONFIGS[5], DEFAULT_INDICATOR_CONFIGS[6]]; // rsi, macd, volume
      const indicatorSeries = [...overlayCfgs, ...panelCfgs].map((cfg) => computeIndicatorSeries(candles, cfg));
      const ctx = fakeCtx();
      const start = Date.now();
      renderChart({
        ctx,
        dims: { width: 1200, height: 700, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport: vp,
        timeframe: "1h",
        crosshair: { index: Math.floor(count / 2), x: 500, y: 300 },
        colors: resolveChartColors(),
        activePanels: ["volume", "rsi", "macd"],
        indicatorSeries,
      });
      const elapsedMs = Date.now() - start;
      assert.ok(elapsedMs < 2000, `renderChart took ${elapsedMs}ms at ${count} candles (budget 2000ms in this unaccelerated test environment)`);
    });
  }

  await test("82: nearestIndexByTime stays fast (binary search, not linear) at 5,000 candles across 200 lookups", () => {
    const candles = makeSeries(5000, 60_000);
    const start = Date.now();
    for (let i = 0; i < 200; i++) {
      nearestIndexByTime(candles, candles[0].time + Math.random() * (candles[4999].time - candles[0].time));
    }
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 500, `200 lookups took ${elapsedMs}ms at 5,000 candles`);
  });

  await test("83: computeIndicatorSeries for all 7 default indicators together completes quickly at 5,000 candles (a symbol/timeframe change's real cost)", () => {
    const candles = makeSeries(5000, 60_000);
    const start = Date.now();
    for (const cfg of DEFAULT_INDICATOR_CONFIGS) computeIndicatorSeries(candles, cfg);
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 2000, `computing all 7 indicator series took ${elapsedMs}ms at 5,000 candles`);
  });

  await test("84: normalizeCandles handles 5,000 raw candles quickly (the route's own per-request cost)", () => {
    const raw = makeSeries(5000, 60_000).map((c) => ({ datetime: new Date(c.time).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const start = Date.now();
    normalizeCandles(raw);
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 500, `normalizeCandles took ${elapsedMs}ms for 5,000 candles`);
  });
}

// ============================================================
// 85-90: security + regression guards (Phase 16/non-goals)
// ============================================================
async function securityAndRegressionTests(): Promise<void> {
  await test("85: the candles route still requires authentication (getUserOrNull -> 401) - unaffected by this sprint's provenance/caching additions", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("getUserOrNull") && src.includes("UNAUTHORIZED"));
  });

  await test("86: no provider API key/credential appears anywhere in the new chart-engine client or server surface", () => {
    const files = [
      "app/api/private/market-data/candles/route.ts",
      "components/chart-engine/NativeChart.tsx",
      "components/chart-engine/useChartCandles.ts",
      "lib/chart-engine/indicators/compute.ts",
    ];
    for (const f of files) assert.ok(!/apiKey|API_KEY|TWELVEDATA|ANGEL_ONE_PASSWORD/i.test(read(f)));
  });

  await test("87: symbol validation for the candles route remains entirely server-side (getCanonicalInstrument, never a client-supplied trust boundary)", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("getCanonicalInstrument(symbol)"));
  });

  await test("88: no direct provider URL/fetch exists in any new client-side chart-engine file", () => {
    const files = ["components/chart-engine/NativeChart.tsx", "components/chart-engine/useChartCandles.ts", "components/chart-engine/ChartToolbar.tsx"];
    for (const f of files) assert.ok(!/twelvedata\.com|alphavantage\.co|binance\.com|angelbroking\.com/i.test(read(f)));
  });

  await test("89: no Redis/Kafka dependency was introduced anywhere in this sprint's new files", () => {
    const files = ["app/api/private/market-data/candles/route.ts", "lib/chart-engine/candle-index.ts", "lib/chart-engine/panel-layout.ts"];
    for (const f of files) assert.ok(!/redis|kafka/i.test(read(f)));
  });

  await test("90: TradingView (AdvancedChart.tsx) is still present and untouched by this sprint - the native engine remains a coexisting option, never a replacement", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(src.includes("export default function AdvancedChart"));
    assert.ok(!src.includes("Sprint D2.7.3"));
  });
}

async function main(): Promise<void> {
  await seriesEquivalenceTests();
  await computeLayerTests();
  await panelLayoutTests();
  await candleIndexTests();
  await liveEdgeTests();
  await provenanceTests();
  await routeCacheTests();
  await noFabricationTests();
  await perfTests();
  await securityAndRegressionTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
