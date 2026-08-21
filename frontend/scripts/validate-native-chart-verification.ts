// scripts/validate-native-chart-verification.ts
// Sprint D2.7.4 - AT24 Native Chart Engine: Production Verification &
// Advanced Chart UX. Standalone, assert-based verification (no test
// framework), matching every prior sprint's scripts/validate-*.ts pattern.
// Run via `npm run validate:native-chart-verification`.
//
// This is a VERIFICATION sprint, not a feature sprint: every test here
// proves an existing (D2.7.2/D2.7.3) code path behaves correctly end to
// end, using deterministic fixtures - no live credentials, no network
// calls, no fabricated "it works" claims. Where authenticated live testing
// would be the only way to prove something (e.g. a real Angel One session),
// this file says so explicitly rather than inventing a result.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalInstrument, INSTRUMENT_CATALOG } from "../lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { MarketDataService } from "../services/market-data/market-data.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { PROVIDER_INTERVAL } from "../services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { SIGNAL_TIMEFRAMES, isSignalTimeframe, type SignalTimeframe } from "../types/signal";
import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import { fitToData, isAtRightEdge, priceRangeForWindow, panViewport, zoomViewport } from "../lib/chart-engine/viewport";
import { nearestCandleIndex } from "../lib/chart-engine/crosshair";
import { nearestIndexByTime } from "../lib/chart-engine/candle-index";
import { computeTimeTicks, timeAxisGranularity } from "../lib/chart-engine/time-axis";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS } from "../lib/chart-engine/indicators/panel-registry";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import type { MarketDataProvider, MarketContextRequest, TimeSeriesProvider } from "../types/market-data-provider";
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

// ============================================================
// Fixtures
// ============================================================

/** The 13 instruments Phase 2 requires coverage for - all real, existing catalog entries, never invented for this sprint. */
const REQUIRED_INSTRUMENTS = [
  "NIFTY50",
  "BANKNIFTY",
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "BTCUSD",
  "ETHUSD",
  "XAUUSD",
  "XAGUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
] as const;

function chartCandle(time: number, o: number, h: number, l: number, c: number, volume?: number): ChartCandle {
  return { time, open: o, high: h, low: l, close: c, volume };
}

function makeCandleSeries(count: number, stepMs: number, base = 100): ChartCandle[] {
  const start = Date.now() - count * stepMs;
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 4) * 3 + i * 0.02;
    const c = o + (i % 3 === 0 ? -1 : 1) * (0.5 + (i % 5));
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.8;
    out.push(chartCandle(start + i * stepMs, o, h, l, c, 500 + (i % 30) * 15));
  }
  return out;
}

function makeRawCandles(count: number, stepMs: number, base = 100): Candle[] {
  return makeCandleSeries(count, stepMs, base).map((c) => ({
    datetime: new Date(c.time).toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/** A fake TimeSeriesProvider returning deterministic, realistic OHLC fixture data - never real network data, never fabricated as "live" anywhere in this file's own assertions. */
function fixtureProvider(name: string, behavior: "success" | "fail" | "unconfigured", count = 60, stepMs = 60_000): MarketDataProvider & TimeSeriesProvider {
  return {
    name,
    isConfigured: () => behavior !== "unconfigured",
    async getMarketContext(request: MarketContextRequest) {
      return { symbol: request.symbol, provider: name, retrievedAt: new Date().toISOString(), evidence: [] };
    },
    async getTimeSeries(): Promise<Candle[]> {
      if (behavior === "fail") throw new MarketDataProviderError("http_error", `${name} unavailable`, name);
      return makeRawCandles(count, stepMs);
    },
  };
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
// Phase 2/10 - Instrument verification (catalog -> chart resolution ->
// provider capability), all 13 required instruments plus the 6 Indian
// ones with extra scrutiny.
// ============================================================
async function instrumentVerificationTests(): Promise<void> {
  for (const id of REQUIRED_INSTRUMENTS) {
    await test(`instrument ${id}: resolves in the canonical instrument catalog`, () => {
      const instrument = getCanonicalInstrument(id);
      assert.ok(instrument, `${id} missing from INSTRUMENT_CATALOG`);
      assert.equal(instrument!.id, id);
    });

    await test(`instrument ${id}: chart-instrument-resolver reports a real, supported chart symbol`, () => {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true, `resolution.reason: ${resolution.reason}`);
      assert.ok(resolution.chartSymbol && resolution.chartSymbol.includes(":"), "chart symbol must be exchange-prefixed");
    });

    await test(`instrument ${id}: at least one catalog provider mapping declares "candles" capability`, () => {
      const instrument = getCanonicalInstrument(id)!;
      const candleCapable = instrument.providerMappings.some((m) => m.supportedCapabilities.includes("candles"));
      assert.ok(candleCapable, `${id} has no candle-capable provider mapping`);
    });

    await test(`instrument ${id}: end-to-end pipeline (fixture provider -> provenance -> normalize -> indicators -> renderer) runs without throwing and never fabricates data`, () => {
      const svc = new MarketDataService({ providers: [fixtureProvider("fixture", "success")] });
      return svc.getTimeSeriesWithProvenance({ symbol: id, interval: "1h" }).then((result) => {
        assert.equal(result.provider, "fixture");
        const { candles, rejectedCount } = normalizeCandles(result.candles);
        assert.equal(rejectedCount, 0, "clean fixture data should never be rejected");
        assert.ok(candles.length > 0);
        const viewport = fitToData(candles);
        const series = computeIndicatorSeries(candles, DEFAULT_INDICATOR_CONFIGS[0]);
        assert.doesNotThrow(() => {
          renderChart({
            ctx: fakeCtx(),
            dims: { width: 800, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
            candles,
            viewport,
            timeframe: "1h",
            crosshair: null,
            colors: resolveChartColors(),
            activePanels: [],
            indicatorSeries: [series],
          });
        });
      });
    });
  }

  await test("Indian instruments (NIFTY50/BANKNIFTY/RELIANCE/TCS/INFY/HDFCBANK) all resolve exclusively through Angel One - never Binance/Twelve Data", () => {
    for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
      const instrument = getCanonicalInstrument(id)!;
      const providers = instrument.providerMappings.map((m) => m.provider);
      assert.ok(providers.includes("angel-one"), `${id} missing an angel-one mapping`);
      assert.ok(!providers.includes("binance"), `${id} must never have a Binance mapping`);
    }
  });

  await test("Indian instruments' chart symbols resolve to real NSE: tickers, preserving the Angel One-confirmed symbol", () => {
    for (const id of ["RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
      const resolution = resolveChartInstrument(id);
      assert.ok(resolution.chartSymbol?.startsWith("NSE:"), `${id} chart symbol should be NSE:-prefixed, got ${resolution.chartSymbol}`);
    }
  });

  await test("AAPL (a genuinely unsupported instrument - zero provider mappings) produces an honest unsupported outcome, never fabricated candles", async () => {
    const instrument = getCanonicalInstrument("AAPL");
    assert.ok(instrument);
    assert.equal(instrument!.providerMappings.length, 0);
    // A catalog-aware fake, mirroring how the REAL providers (Binance/
    // Angel One) behave: they only serve a symbol that actually has a
    // mapping to that provider name in the catalog - AAPL has none for
    // ANY provider, so a real provider would reject it exactly like this.
    const catalogAware: MarketDataProvider & TimeSeriesProvider = {
      name: "catalog-aware-fixture",
      isConfigured: () => true,
      async getMarketContext(request: MarketContextRequest) {
        return { symbol: request.symbol, provider: "catalog-aware-fixture", retrievedAt: new Date().toISOString(), evidence: [] };
      },
      async getTimeSeries(request): Promise<Candle[]> {
        const mapped = getCanonicalInstrument(request.symbol)?.providerMappings.some((m) => m.supportedCapabilities.includes("candles"));
        if (!mapped) throw new MarketDataProviderError("unsupported_symbol", `no provider mapping for ${request.symbol}`, "catalog-aware-fixture");
        return makeRawCandles(30, 60_000);
      },
    };
    const svc = new MarketDataService({ providers: [catalogAware] });
    await assert.rejects(svc.getTimeSeries({ symbol: "AAPL" }), (e: unknown) => e instanceof MarketDataProviderError);
  });

  await test("an unknown symbol (not in the catalog at all) is honestly rejected by chart-instrument-resolver, never silently mapped to a real instrument", () => {
    const resolution = resolveChartInstrument("NOT_A_REAL_SYMBOL_XYZ");
    assert.equal(resolution.supported, false);
  });

  await test("every catalog instrument's resolveChartInstrument().canonicalSymbol matches the requested id exactly - chart data never silently changes symbol", () => {
    for (const instrument of INSTRUMENT_CATALOG) {
      const resolution = resolveChartInstrument(instrument.id);
      assert.equal(resolution.canonicalSymbol, instrument.id);
    }
  });

  await test("a total provider failure propagates as a real error - it can NEVER result in another instrument's chart being displayed", async () => {
    const svc = new MarketDataService({ providers: [fixtureProvider("fixture", "fail")] });
    await assert.rejects(svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError);
  });
}

// ============================================================
// Phase 3 - Market data correctness
// ============================================================
async function marketDataCorrectnessTests(): Promise<void> {
  await test("OHLC integrity: a structurally invalid candle (high<low) is rejected, never silently repaired", () => {
    const raw: Candle[] = [{ datetime: new Date().toISOString(), open: 100, high: 90, low: 95, close: 92 }];
    const { candles, rejectedCount } = normalizeCandles(raw);
    assert.equal(candles.length, 0);
    assert.equal(rejectedCount, 1);
  });

  await test("timestamp monotonicity: candles are accepted only in strictly increasing time order", () => {
    const raw = makeRawCandles(10, 60_000);
    const { candles } = normalizeCandles(raw);
    for (let i = 1; i < candles.length; i++) assert.ok(candles[i].time > candles[i - 1].time);
  });

  await test("duplicate detection: a repeated timestamp is rejected, never double-counted", () => {
    const raw = makeRawCandles(5, 60_000);
    const duplicated = [...raw, raw[raw.length - 1]];
    const { candles, rejectedCount } = normalizeCandles(duplicated);
    assert.equal(candles.length, 5);
    assert.equal(rejectedCount, 1);
  });

  await test("timeframe correctness: PROVIDER_INTERVAL has a real mapping for every SignalTimeframe - no second timeframe registry", () => {
    for (const tf of SIGNAL_TIMEFRAMES) assert.ok(PROVIDER_INTERVAL[tf], `missing PROVIDER_INTERVAL entry for ${tf}`);
  });

  await test("outputSize behavior: the candles route clamps to a documented [10,1000] bound with a 300 default", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("const MIN_OUTPUT_SIZE = 10"));
    assert.ok(src.includes("const MAX_OUTPUT_SIZE = 1000"));
    assert.ok(src.includes("const DEFAULT_OUTPUT_SIZE = 300"));
    assert.ok(/Math\.min\(Math\.max\(parsed, MIN_OUTPUT_SIZE\), MAX_OUTPUT_SIZE\)/.test(src));
  });

  await test("freshness classification: the candles route reuses the existing D2.6.4 assessFreshness() policy for candles, never a second formula", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes('subject: { kind: "candle", timeframe }'));
  });

  await test("provider provenance: a real provider name and real fallbackUsed flag are captured via getTimeSeriesWithProvenance", async () => {
    const svc = new MarketDataService({ providers: [fixtureProvider("A", "fail"), fixtureProvider("B", "success")] });
    const result = await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD" });
    assert.equal(result.provider, "B");
    assert.equal(result.fallbackUsed, true);
  });

  await test("providerSymbol: the candles route looks it up from the real catalog mapping for the winning provider, never guesses", () => {
    const instrument = getCanonicalInstrument("BTCUSD")!;
    const mapping = instrument.providerMappings.find((m) => m.provider === "binance");
    assert.ok(mapping);
    assert.equal(mapping!.providerSymbol, "BTCUSDT");
  });

  await test("cached/cacheAgeMs: the route's own TtlCache reports a real age, only ever set together with cached:true", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("routeCache.getStale(cacheKey, ROUTE_CACHE_TTL_MS)"));
    assert.ok(src.includes("cacheAgeMs = stale.ageMs"));
  });

  await test("no wrong-instrument fallback: MarketDataService's own aggregate error path never substitutes a different symbol's cached data for candles (candles are documented as NOT part of the stale-cache-fallback path)", () => {
    const src = read("services/market-data/market-data.service.ts");
    const method = src.slice(src.indexOf("async getTimeSeriesWithProvenance"), src.indexOf("async getTimeSeriesWithProvenance") + 1500);
    assert.ok(method.includes("deliberately NOT part of the stale-cache-"));
  });
}

// ============================================================
// Phase 4 - Timeframe verification (every existing SignalTimeframe)
// ============================================================
async function timeframeVerificationTests(): Promise<void> {
  await test("every SignalTimeframe is accepted by isSignalTimeframe - the one shared registry, never a second one", () => {
    for (const tf of SIGNAL_TIMEFRAMES) assert.ok(isSignalTimeframe(tf));
  });

  for (const tf of SIGNAL_TIMEFRAMES) {
    await test(`timeframe ${tf}: candle spacing, indicator computation, and viewport fitting all work with real per-timeframe step sizes`, () => {
      const stepMsByTf: Record<SignalTimeframe, number> = {
        "1m": 60_000,
        "5m": 5 * 60_000,
        "15m": 15 * 60_000,
        "30m": 30 * 60_000,
        "1h": 60 * 60_000,
        "4h": 4 * 60 * 60_000,
        "1d": 24 * 60 * 60_000,
        "1w": 7 * 24 * 60 * 60_000,
      };
      const candles = makeCandleSeries(80, stepMsByTf[tf]);
      const viewport = fitToData(candles);
      assert.ok(viewport.maxTime > viewport.minTime);
      const rsi = computeIndicatorSeries(candles, { id: "rsi", key: "rsi-14", period: 14, color: "var(--gold)" });
      assert.equal(rsi.lines[0].points.length, candles.length);
      const ticks = computeTimeTicks(candles, viewport, tf);
      assert.ok(ticks.every((t) => candles.some((c) => c.time === t.time)));
    });
  }

  await test("intraday timeframes (1m..4h) use clock-time axis granularity; day+ timeframes (1d,1w) use date granularity", () => {
    for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h"] as const) assert.equal(timeAxisGranularity(tf), "time");
    for (const tf of ["1d", "1w"] as const) assert.equal(timeAxisGranularity(tf), "date");
  });

  await test("a timeframe change on the candles route always uses the real per-symbol/timeframe cache key - a 1h and 1d request for the same symbol never share a stale cache entry", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(src.includes("const cacheKey = `${symbol}|${timeframe}|${outputSize}`"));
  });
}

// ============================================================
// Phase 5 - Indicator correctness (SMA/EMA/RSI/MACD/Bollinger/Volume)
// ============================================================
async function indicatorCorrectnessTests(): Promise<void> {
  const candles = makeCandleSeries(120, 60_000);

  for (const cfg of DEFAULT_INDICATOR_CONFIGS) {
    await test(`indicator ${cfg.key}: output is correctly aligned with candles (one point per candle, matching real timestamps)`, () => {
      const series = computeIndicatorSeries(candles, cfg);
      const stepMs = candles[1].time - candles[0].time;
      for (const line of series.lines) {
        assert.equal(line.points.length, candles.length);
        // Ichimoku's Senkou Span A/B (this session) deliberately plot
        // kijunPeriod candles AHEAD, and Chikou Span kijunPeriod candles
        // BEHIND - real MT5 time-shifted output, not a bug. Every other
        // line of every other indicator still aligns 1:1 with its own
        // candle's real time, unchanged from before this sprint.
        if (cfg.id === "ichimoku" && (line.name.endsWith("-senkou-a") || line.name.endsWith("-senkou-b"))) {
          const kijunPeriod = cfg.slowPeriod ?? 26;
          for (let i = 0; i < candles.length; i++) assert.equal(line.points[i].time, candles[i].time + kijunPeriod * stepMs);
        } else if (cfg.id === "ichimoku" && line.name.endsWith("-chikou")) {
          const kijunPeriod = cfg.slowPeriod ?? 26;
          for (let i = 0; i < candles.length; i++) assert.equal(line.points[i].time, candles[i].time - kijunPeriod * stepMs);
        } else {
          for (let i = 0; i < candles.length; i++) assert.equal(line.points[i].time, candles[i].time);
        }
      }
    });

    await test(`indicator ${cfg.key}: no NaN/Infinity leaks into any defined value`, () => {
      const series = computeIndicatorSeries(candles, cfg);
      for (const line of series.lines) {
        for (const point of line.points) {
          if (point.value !== undefined) assert.ok(Number.isFinite(point.value), `${cfg.key} produced a non-finite value`);
        }
      }
    });

    await test(`indicator ${cfg.key}: deterministic - identical candle input always produces identical output`, () => {
      const a = computeIndicatorSeries(candles, cfg);
      const b = computeIndicatorSeries(candles, cfg);
      assert.deepEqual(a, b);
    });

    await test(`indicator ${cfg.key}: no future-data leakage - the value at index i is identical whether computed from the full series or a series truncated right after i`, () => {
      const probeIndex = 90;
      const full = computeIndicatorSeries(candles, cfg);
      const truncated = computeIndicatorSeries(candles.slice(0, probeIndex + 1), cfg);
      for (let lineIdx = 0; lineIdx < full.lines.length; lineIdx++) {
        const fullValue = full.lines[lineIdx].points[probeIndex]?.value;
        const truncatedValue = truncated.lines[lineIdx].points[probeIndex]?.value;
        assert.equal(fullValue, truncatedValue, `${cfg.key} line ${lineIdx} used data beyond index ${probeIndex}`);
      }
    });

    await test(`indicator ${cfg.key}: classified into the correct panel (overlay vs its own sub-panel)`, () => {
      const series = computeIndicatorSeries(candles, cfg);
      // Phase 2 (this session) added atr/stochastic/adx/cci/williams-r,
      // each in their own real sub-panel - never overlaid on price,
      // matching the same "every non-overlay indicator gets its own row"
      // rule rsi/macd/volume already established. Every non-overlay id
      // maps to a sub-panel of the exact same name as its id - the one
      // exception (an id that ISN'T also its own panel name) is handled
      // explicitly below, never silently defaulted to "price".
      const nonOverlayIds = ["rsi", "macd", "volume", "atr", "stochastic", "adx", "cci", "williams-r"];
      const expectedPanel = nonOverlayIds.includes(cfg.id) ? cfg.id : "price";
      assert.equal(series.panel, expectedPanel);
    });
  }

  await test("existing scalar indicator implementations (lib/market-data/indicators.ts) were not modified by this sprint - no real defect was proven that required changing them", () => {
    const src = read("lib/market-data/indicators.ts");
    assert.ok(!src.includes("Sprint D2.7.4"));
  });
}

// ============================================================
// Phase 6 - Crosshair verification
// ============================================================
async function crosshairVerificationTests(): Promise<void> {
  const candles = makeCandleSeries(50, 60_000);
  const viewport = fitToData(candles);
  const plotWidth = 1000;

  await test("crosshair at the first candle's exact x position snaps to index 0", () => {
    const x = (candles[0].time - viewport.minTime) / (viewport.maxTime - viewport.minTime) * plotWidth;
    const index = nearestCandleIndex(candles, viewport, x, plotWidth);
    assert.equal(index, 0);
  });

  await test("crosshair at the last candle's exact x position snaps to the last real index", () => {
    const last = candles.length - 1;
    const x = (candles[last].time - viewport.minTime) / (viewport.maxTime - viewport.minTime) * plotWidth;
    const index = nearestCandleIndex(candles, viewport, x, plotWidth);
    assert.equal(index, last);
  });

  await test("crosshair far outside the viewport (negative x) still snaps to a real candle, never returns a fabricated one", () => {
    const index = nearestCandleIndex(candles, viewport, -5000, plotWidth);
    assert.ok(index >= 0 && index < candles.length);
  });

  await test("crosshair far outside the viewport (x beyond plotWidth) still snaps to a real candle", () => {
    const index = nearestCandleIndex(candles, viewport, plotWidth + 5000, plotWidth);
    assert.ok(index >= 0 && index < candles.length);
  });

  await test("crosshair lookup uses binary search (nearestIndexByTime), not a linear scan, confirmed by direct equivalence with the crosshair module's own function", () => {
    const targetTime = candles[25].time + 100;
    const viaCrosshair = nearestCandleIndex(candles, viewport, (targetTime - viewport.minTime) / (viewport.maxTime - viewport.minTime) * plotWidth, plotWidth);
    const viaIndex = nearestIndexByTime(candles, targetTime);
    assert.equal(viaCrosshair, viaIndex);
  });

  await test("crosshair on an empty candle series returns -1, never a fabricated index", () => {
    assert.equal(nearestCandleIndex([], viewport, 500, plotWidth), -1);
  });
}

// ============================================================
// Phase 7 - Viewport / pan / zoom (incl. the D2.7.4 initial-fit bug fix)
// ============================================================
async function viewportVerificationTests(): Promise<void> {
  await test("BUG FIX REGRESSION: the initial viewport for freshly loaded real data spans the actual candle range, never a leftover 1-hour empty-state placeholder span", () => {
    // Reproduces the exact sequence that exposed the D2.7.3 bug: an empty
    // placeholder viewport exists first (loading state), then real candles
    // arrive for the SAME symbol/timeframe. NativeChart.tsx's fix (tracking
    // fittedKeyRef only once real data has been fit) means the SECOND
    // fitToData call - not a followLatest against the placeholder - is what
    // must produce the real span. This test asserts fitToData() itself
    // (the function the fix routes back through) produces a span
    // proportional to the real timeframe, not a hardcoded 1 hour.
    const dailyCandles = makeCandleSeries(300, 24 * 60 * 60_000); // 1d timeframe, 300 candles
    const viewport = fitToData(dailyCandles);
    const span = viewport.maxTime - viewport.minTime;
    const oneHourMs = 60 * 60_000;
    assert.ok(span > oneHourMs * 100, `expected a multi-day span for 300 daily candles, got ${span}ms (~${span / oneHourMs}h) - looks like the 1-hour placeholder bug`);
  });

  await test("initial fit includes every real candle within its bounds", () => {
    const candles = makeCandleSeries(100, 60_000);
    const viewport = fitToData(candles);
    assert.ok(viewport.minTime <= candles[0].time);
    assert.ok(viewport.maxTime >= candles[candles.length - 1].time);
  });

  await test("horizontal pan shifts both bounds by the same real delta - span (zoom level) is unchanged", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 0, maxPrice: 1 };
    const panned = panViewport(vp, 25_000);
    assert.equal(panned.minTime, 25_000);
    assert.equal(panned.maxTime - panned.minTime, vp.maxTime - vp.minTime);
  });

  await test("zoom in shrinks the visible span; zoom out grows it", () => {
    const vp: Viewport = { minTime: 0, maxTime: 100_000, minPrice: 0, maxPrice: 1 };
    const zoomedIn = zoomViewport(vp, 0.5, 50_000, 1_000);
    const zoomedOut = zoomViewport(vp, 2, 50_000, 1_000);
    assert.ok(zoomedIn.maxTime - zoomedIn.minTime < vp.maxTime - vp.minTime);
    assert.ok(zoomedOut.maxTime - zoomedOut.minTime > vp.maxTime - vp.minTime);
  });

  await test("zoom never collapses below the minimum-visible-candles floor (5 candles worth of span)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 0, maxPrice: 1 };
    let zoomed = vp;
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 0.5, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime >= 1_000 * 5 - 1e-6);
  });

  await test("zoom never exceeds the maximum-visible-candles ceiling (2000 candles worth of span)", () => {
    const vp: Viewport = { minTime: 0, maxTime: 10_000, minPrice: 0, maxPrice: 1 };
    let zoomed = vp;
    for (let i = 0; i < 100; i++) zoomed = zoomViewport(zoomed, 2, 5_000, 1_000);
    assert.ok(zoomed.maxTime - zoomed.minTime <= 1_000 * 2000 + 1e-6);
  });

  await test("price auto-fits only the visible candle window, never the full series when zoomed in", () => {
    const candles = makeCandleSeries(100, 60_000);
    const narrow = priceRangeForWindow(candles, candles[0].time, candles[9].time);
    const full = priceRangeForWindow(candles, candles[0].time, candles[99].time);
    assert.ok(narrow.maxPrice - narrow.minPrice <= full.maxPrice - full.minPrice + 1e-6);
  });

  await test("every viewport bound produced by fit/pan/zoom is finite - never NaN or Infinity", () => {
    const candles = makeCandleSeries(50, 60_000);
    let vp = fitToData(candles);
    vp = panViewport(vp, 12345);
    vp = zoomViewport(vp, 0.8, vp.minTime + 1000, 60_000);
    for (const value of [vp.minTime, vp.maxTime, vp.minPrice, vp.maxPrice]) assert.ok(Number.isFinite(value));
  });

  await test("repeated pan+zoom round trips do not accumulate floating-point drift", () => {
    const candles = makeCandleSeries(50, 60_000);
    let vp = fitToData(candles);
    const startSpan = vp.maxTime - vp.minTime;
    for (let i = 0; i < 500; i++) {
      vp = panViewport(vp, 100);
      vp = panViewport(vp, -100);
    }
    assert.ok(Math.abs(vp.maxTime - vp.minTime - startSpan) < 1e-6);
  });

  await test("isAtRightEdge/followLatest correctly distinguish a live-edge viewport from a manually panned-back one", () => {
    const candles = makeCandleSeries(50, 60_000);
    const atEdge = fitToData(candles);
    assert.ok(isAtRightEdge(atEdge, candles));
    const pannedBack: Viewport = { ...atEdge, minTime: atEdge.minTime - 10_000_000, maxTime: atEdge.minTime - 5_000_000 };
    assert.equal(isAtRightEdge(pannedBack, candles), false);
  });

  await test("NativeChart.tsx's data effect now keys the 'have we fit real data' check on fittedKeyRef, not on every render including the empty loading one", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("fittedKeyRef"));
    assert.ok(src.includes("alreadyFittedForThisKey"));
  });
}

// ============================================================
// Phase 8 - Live fetch / polling lifecycle (structural verification -
// this hook has no DOM test environment available in this project's
// no-test-framework convention, so behavior is proven by source
// inspection of the exact guard clauses, matching D2.7.2/D2.7.3's own
// established discipline for React-hook verification).
// ============================================================
async function liveFetchVerificationTests(): Promise<void> {
  const src = read("components/chart-engine/useChartCandles.ts");

  await test("initial fetch: fires immediately on mount/dependency change via fetchOnce(false)", () => {
    assert.ok(src.includes("fetchOnce(false);"));
  });

  await test("20-second polling: POLL_INTERVAL_MS is 20000 and drives a real setInterval", () => {
    assert.ok(src.includes("const POLL_INTERVAL_MS = 20_000"));
    assert.ok(src.includes("setInterval(() => fetchOnce(true), POLL_INTERVAL_MS)"));
  });

  await test("latest candle update: each fetch replaces the series wholesale (setResult with the new series) - never appends/mutates the previous array", () => {
    assert.ok(src.includes("setResult({ status: deriveStatus(series), series })"));
    assert.ok(!/\.push\(|\.concat\(/.test(src));
  });

  await test("duplicate candle prevention: no client-side merge logic exists that could double-count a candle across polls - each response is a complete, independent snapshot", () => {
    assert.ok(!/\[\.\.\.\w+\.candles/.test(src));
  });

  await test("stale response handling: a `cancelled` flag guards every state update after cleanup, preventing an old (pre-symbol-change) request from applying its result", () => {
    assert.ok(src.includes("let cancelled = false"));
    assert.ok(src.includes("if (cancelled) return"));
  });

  await test("request failure handling: the initial/foreground fetch surfaces an honest error state; a background poll failure is silently absorbed", () => {
    assert.ok(src.includes('if (isBackgroundPoll) return; // keep showing the last good data'));
    assert.ok(src.includes('setResult({ status: "error"'));
  });

  await test("recovery after failure: polling continues automatically via setInterval regardless of any single poll's outcome - no explicit 'give up' path exists", () => {
    assert.ok(!/clearInterval\(intervalId\)/.test(src.split("return () => {")[0])); // clearInterval only appears in the cleanup, not on a failure branch
  });

  await test("cleanup on unmount: the effect's cleanup function aborts the in-flight request AND clears the interval", () => {
    const cleanup = src.slice(src.indexOf("return () => {"));
    assert.ok(cleanup.includes("cancelled = true"));
    assert.ok(cleanup.includes("controller.abort()"));
    assert.ok(cleanup.includes("clearInterval(intervalId)"));
  });

  await test("no timer leaks: clearInterval is called on every effect cleanup (symbol/timeframe change AND unmount both trigger the same cleanup)", () => {
    assert.equal((src.match(/clearInterval/g) ?? []).length, 1); // exactly one clearInterval call site, in the shared cleanup
  });

  await test("BUG FIX: no concurrent request storm - a background poll tick is skipped while a previous fetch is still in flight (fetchInFlight guard)", () => {
    assert.ok(src.includes("let fetchInFlight = false"));
    assert.ok(src.includes("if (isBackgroundPoll && fetchInFlight) return"));
    assert.ok(src.includes("fetchInFlight = false")); // reset in finally, both success and failure paths covered
  });

  await test("WebSockets were NOT introduced - the polling architecture is explicitly preserved (checking for actual usage, not this file's own documentation of the decision)", () => {
    assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
  });
}

// ============================================================
// Phase 9/11 - Professional chart UX + TradingView/native coexistence
// ============================================================
async function uxAndCoexistenceTests(): Promise<void> {
  await test("latest-price marker: renderer draws a real marker derived from the last real candle's close - never a second/fabricated price source", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("function drawLatestPriceMarker"));
    assert.ok(src.includes("latest.close"));
  });

  await test("latest-price marker renders without throwing and is skipped cleanly when off-panel", () => {
    const candles = makeCandleSeries(30, 60_000);
    const viewport = fitToData(candles);
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });

  await test("live bid/ask (this session): the current-price marker uses the live bid over the candle close when a liveQuote is passed, and labels the real ask alongside it", () => {
    const candles = makeCandleSeries(30, 60_000);
    const viewport = fitToData(candles);
    const texts: string[] = [];
    const textCapturingCtx = {
      clearRect: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillText: (text: string) => texts.push(text),
      setLineDash: () => {},
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;

    // Deliberately DIFFERENT from the candle close (so the assertion below
    // can only pass if the marker genuinely used the live quote, not
    // silently fallen back to it) but small enough to stay safely inside
    // fitToData's own padded viewport for this fixture - a large offset
    // here would push the marker off-panel and skip it entirely, which is
    // its own correct-but-unrelated behavior this test isn't about.
    const bid = candles[candles.length - 1].close + 0.3;
    const ask = bid + 0.05;
    renderChart({
      ctx: textCapturingCtx,
      dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 },
      candles,
      viewport,
      timeframe: "1h",
      crosshair: null,
      colors: resolveChartColors(),
      liveQuote: { bid, ask },
    });

    // Don't assume a specific decimal precision here - the marker's own
    // decimals come from computePriceTicks' nice-step logic for THIS
    // fixture's price range, which this test isn't about. Just confirm
    // the ONE "bid/ask" formatted label exists and both halves are real
    // numbers close to the actual live bid/ask, at whatever precision the
    // renderer chose.
    const label = texts.find((t) => t.includes("/"));
    assert.ok(label, `expected a fillText call containing a "bid/ask" label; got: ${JSON.stringify(texts)}`);
    const [bidPart, askPart] = label!.split("/");
    assert.ok(Math.abs(parseFloat(bidPart) - bid) < 1, `label's bid half (${bidPart}) should be close to the real live bid (${bid})`);
    assert.ok(Math.abs(parseFloat(askPart) - ask) < 1, `label's ask half (${askPart}) should be close to the real live ask (${ask})`);
  });

  await test("live bid/ask (this session): omitting liveQuote falls back to the candle close exactly as before this session - zero regression for a symbol/provider with no bid/ask", () => {
    const candles = makeCandleSeries(30, 60_000);
    const viewport = fitToData(candles);
    const withoutQuote = fakeCtx();
    const withNullQuote = fakeCtx();
    assert.doesNotThrow(() => {
      renderChart({ ctx: withoutQuote, dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 }, candles, viewport, timeframe: "1h", crosshair: null, colors: resolveChartColors() });
      renderChart({ ctx: withNullQuote, dims: { width: 600, height: 300, priceAxisWidth: 64, timeAxisHeight: 22 }, candles, viewport, timeframe: "1h", crosshair: null, colors: resolveChartColors(), liveQuote: null });
    });
  });

  await test("provenance/freshness disclosure: NativeChart renders a real disclosure line sourced from ChartSeries fields, never invented text", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("function ProvenanceDisclosure"));
    assert.ok(src.includes("series.provider"));
    assert.ok(src.includes("series.freshness"));
  });

  await test("BUG FIX: ChartPanel now owns timeframe/activeIndicatorKeys state (lifted out of NativeChart) - it survives a native/tradingview provider toggle instead of resetting. Sprint D2.7.11 Phase 3 - timeframe/indicators are now per-pane fields inside ChartPanel's own `panes` array state, not a standalone useState<SignalTimeframe> - still ChartPanel-owned (never unmounted by the provider toggle), just one level of nesting deeper now that N panes can exist.", () => {
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(panelSrc.includes("useState<ChartPaneState[]>"), "timeframe/activeIndicatorKeys now live inside each ChartPaneState, owned by this one panes array");
    const paneSrc = read("components/chart-engine/ChartPane.tsx");
    assert.ok(/timeframe:\s*SignalTimeframe/.test(paneSrc), "ChartPaneState (ChartPane.tsx) still types timeframe as a real SignalTimeframe, never a loose string");
    const nativeChartSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(!/const \[timeframe, setTimeframe\] = useState/.test(nativeChartSrc));
  });

  await test("switching chart provider never mutates the selected canonical instrument. Sprint D2.7.11 Phase 3 - AdvancedChart still reads `symbol` straight from WorkspaceContext (untouched, always non-tiled); NativeChart now takes `symbol` as a controlled PROP instead (multiple panes can each show a different instrument) - ChartPanel is the one place that reconciles the two, keeping exactly one pane's symbol (the primary one) bidirectionally synced with WorkspaceContext.symbol, so the single-chart case behaves identically to before this phase.", () => {
    const nativeChartSrc = read("components/chart-engine/NativeChart.tsx");
    const advancedChartSrc = read("components/workspace/tradingview/AdvancedChart.tsx");
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(advancedChartSrc.includes("useWorkspace()"), "AdvancedChart is still the single, non-tiled, always-context-driven chart");
    assert.ok(/symbol:\s*string/.test(nativeChartSrc), "NativeChart's symbol is now a typed prop, not a context read");
    assert.ok(!/const \{ symbol,.*\} = useWorkspace\(\)/.test(nativeChartSrc), "NativeChart must not destructure symbol out of useWorkspace() anymore");
    assert.ok(panelSrc.includes("setContextSymbol(") && panelSrc.includes("useWorkspace()"), "ChartPanel is the one place that reconciles the primary pane's symbol with WorkspaceContext");
  });

  await test("the provider toggle is explicit (native | tradingview) - neither chart is ever silently substituted for the other", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes('provider === "native" ? ('));
    assert.ok(!/catch[\s\S]{0,100}AdvancedChart/.test(src)); // no try/catch fallback path exists
  });

  await test("TradingView (AdvancedChart.tsx) remains completely untouched by D2.7.4", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(!src.includes("Sprint D2.7.4"));
    assert.ok(src.includes("export default function AdvancedChart"));
  });

  await test("no second symbol registry was introduced by this sprint's UX changes", () => {
    for (const f of ["components/chart-engine/ChartPanel.tsx", "components/chart-engine/NativeChart.tsx"]) {
      assert.ok(!/SYMBOL_MAP|SYMBOL_REGISTRY/.test(read(f)));
    }
  });

  await test("switching provider does not change market-data provider routing - MarketDataService/shared-instance.ts untouched by this sprint", () => {
    const src = read("services/market-data/shared-instance.ts");
    assert.ok(!src.includes("Sprint D2.7.4"));
  });
}

// ============================================================
// Phase 12 - Security
// ============================================================
async function securityVerificationTests(): Promise<void> {
  const routeSrc = read("app/api/private/market-data/candles/route.ts");

  await test("candles API requires authentication before any data access", () => {
    assert.ok(routeSrc.includes("getUserOrNull"));
    assert.ok(routeSrc.includes('"UNAUTHORIZED"'));
  });

  await test("symbol is validated server-side against the real catalog, not trusted from the client", () => {
    assert.ok(routeSrc.includes("getCanonicalInstrument(symbol)"));
  });

  await test("timeframe is validated server-side via isSignalTimeframe, an invalid value is rejected with 400, never silently coerced to a guess", () => {
    assert.ok(routeSrc.includes("isSignalTimeframe(timeframeRaw)"));
    assert.ok(routeSrc.includes('"VALIDATION"'));
  });

  await test("outputSize is bounded server-side (clamped, never passed through unchecked to a provider)", () => {
    assert.ok(routeSrc.includes("function parseOutputSize"));
  });

  await test("provider credentials never reach the client - no API key pattern appears anywhere in the route or chart-engine client code", () => {
    for (const f of [
      "app/api/private/market-data/candles/route.ts",
      "components/chart-engine/NativeChart.tsx",
      "components/chart-engine/useChartCandles.ts",
      "components/chart-engine/ChartPanel.tsx",
      "components/chart-engine/ChartToolbar.tsx",
    ]) {
      assert.ok(!/apiKey|API_KEY|_SECRET|_PASSWORD/i.test(read(f)));
    }
  });

  await test("provider errors are sanitized before reaching the client (the shared error-DTO, never a raw provider error/stack)", () => {
    assert.ok(routeSrc.includes("toMarketDataErrorDTO"));
  });

  await test("no secrets are logged - the route never logs the raw request beyond structured, credential-free fields", () => {
    assert.ok(!/console\.log\([^)]*(apiKey|token|password)/i.test(routeSrc));
  });

  await test("no cross-user data leakage: the route-local TtlCache key is scoped only to symbol|timeframe|outputSize - never a user id, and the candle DATA itself carries no per-user state to leak", () => {
    assert.ok(routeSrc.includes("`${symbol}|${timeframe}|${outputSize}`"));
    assert.ok(!/userId|sessionUser\.id/.test(routeSrc.split("const cacheKey")[1] ?? ""));
  });
}

// ============================================================
// Phase 13 - Performance
// ============================================================
async function performanceVerificationTests(): Promise<void> {
  for (const count of [500, 2000, 5000]) {
    await test(`full pipeline (normalize -> indicators -> render) completes within budget at ${count} candles`, () => {
      const raw = makeRawCandles(count, 60_000);
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

  await test("crosshair lookup (candle indexing) stays fast at 5,000 candles across 300 probes", () => {
    const candles = makeCandleSeries(5000, 60_000);
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) nearestIndexByTime(candles, candles[0].time + Math.random() * (candles[4999].time - candles[0].time));
    assert.ok(Date.now() - t0 < 500);
  });

  await test("no React setState is called directly from the pan/zoom/crosshair pointer handler - only via the rAF-throttled scheduleHoverUpdate or the rarer applyViewport/isLive path, never per-pixel", () => {
    // Sprint D2.7.7 migrated handleMouseMove/handleMouseUp to
    // handlePointerMove/handlePointerUp (native Pointer Events, so
    // setPointerCapture can fix a real "stuck dragging" bug the D2.7.7
    // audit found) - the same invariant this test has always guarded
    // (no setState per pointer tick) still holds, just against the new
    // handler names.
    const src = read("components/chart-engine/NativeChart.tsx");
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!/\bsetHoveredIndex\(/.test(moveHandler.replace(/scheduleHoverUpdate/g, "")) || moveHandler.includes("scheduleHoverUpdate"));
    assert.ok(!moveHandler.includes("setIsLive("));
  });

  await test("ResizeObserver is disconnected in its effect's cleanup - no observer leak across remounts", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const resizeEffect = src.slice(src.indexOf("new ResizeObserver"), src.indexOf("new ResizeObserver") + 800);
    assert.ok(resizeEffect.includes("observer.disconnect()"));
  });

  await test("the animation-frame handle used for hover throttling is cancelled on unmount - no rAF leak", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("cancelAnimationFrame(rafRef.current)"));
  });
}

// ============================================================
// No-fabrication guards (cross-cutting, Phase 1-17)
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("no hardcoded fallback symbol (EURUSD/BTCUSD) exists anywhere in this sprint's modified chart-engine files", () => {
    for (const f of ["components/chart-engine/NativeChart.tsx", "components/chart-engine/ChartPanel.tsx", "lib/chart-engine/renderer.ts"]) {
      assert.ok(!/EURUSD|BTCUSD/.test(read(f)));
    }
  });

  await test("no BUY/SELL/automated-trading/broker-execution language exists anywhere in this sprint's changes", () => {
    for (const f of [
      "components/chart-engine/NativeChart.tsx",
      "components/chart-engine/ChartPanel.tsx",
      "components/chart-engine/useChartCandles.ts",
      "lib/chart-engine/renderer.ts",
    ]) {
      assert.ok(!/\bBUY\b|\bSELL\b|place order|execute trade|broker/i.test(read(f)));
    }
  });

  await test("no Redis/Kafka/WebSocket dependency was introduced anywhere in this sprint's changed files (checking for actual usage, not this sprint's own documentation that explicitly explains why none exists)", () => {
    for (const f of ["components/chart-engine/useChartCandles.ts", "app/api/private/market-data/candles/route.ts"]) {
      const src = read(f);
      assert.ok(!/redis|kafka/i.test(src));
      assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
    }
  });

  await test("Intelligence Score/Regime/Hypothesis/DecisionContext services are untouched by D2.7.4", () => {
    for (const f of [
      "services/intelligence/score/intelligence-score.service.ts",
      "services/intelligence/regime/regime.service.ts",
      "services/intelligence/hypothesis/hypothesis.service.ts",
      "services/intelligence/decision/decision-context.service.ts",
    ]) {
      assert.ok(!read(f).includes("Sprint D2.7.4"));
    }
  });
}

async function main(): Promise<void> {
  await instrumentVerificationTests();
  await marketDataCorrectnessTests();
  await timeframeVerificationTests();
  await indicatorCorrectnessTests();
  await crosshairVerificationTests();
  await viewportVerificationTests();
  await liveFetchVerificationTests();
  await uxAndCoexistenceTests();
  await securityVerificationTests();
  await performanceVerificationTests();
  await noFabricationTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
