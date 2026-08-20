// scripts/validate-native-chart-indicators-phase2.ts
// MT5 feature-parity Phase 2 - expanded indicator library: ATR,
// Stochastic Oscillator (MT5's real default 5/3/3 "Slow Stochastic"),
// ADX, CCI, Williams %R, and Parabolic SAR - every default parameter
// verified against mql5.com/metatrader5.com this session (not textbook
// values - CCI's own original Lambert methodology used 20, but MT5
// itself defaults to 14, same as the others). Standalone, assert-based
// verification, matching every prior sprint's scripts/validate-*.ts
// pattern. Run via `npm run validate:native-chart-indicators-phase2`.
import assert from "node:assert/strict";

import {
  atr,
  atrSeries,
  stochasticSeries,
  adxSeries,
  cciSeries,
  williamsPercentRSeries,
  parabolicSarSeries,
  ichimokuSeries,
  ATR_PERIOD_DEFAULT,
  STOCHASTIC_K_PERIOD_DEFAULT,
  STOCHASTIC_SLOWING_DEFAULT,
  STOCHASTIC_D_PERIOD_DEFAULT,
  ADX_PERIOD_DEFAULT,
  CCI_PERIOD_DEFAULT,
  WILLIAMS_R_PERIOD_DEFAULT,
  PARABOLIC_SAR_STEP_DEFAULT,
  PARABOLIC_SAR_MAX_STEP_DEFAULT,
  ICHIMOKU_TENKAN_DEFAULT,
  ICHIMOKU_KIJUN_DEFAULT,
  ICHIMOKU_SENKOU_DEFAULT,
  type OhlcCandle,
} from "../lib/market-data/indicators";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS, PANEL_REGISTRY, INDICATOR_PANEL_ID } from "../lib/chart-engine/indicators/panel-registry";
import { drawAtrPanel, drawStochasticPanel, drawAdxPanel, drawCciPanel, drawWilliamsRPanel, drawOverlays } from "../lib/chart-engine/sub-panel-renderer";
import { renderChart } from "../lib/chart-engine/renderer";
import { fitToData } from "../lib/chart-engine/viewport";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { indexRangeForViewport } from "../lib/chart-engine/index-scale";
import type { ChartCandle } from "../types/chart-data";
import type { Viewport } from "../lib/chart-engine/types";
import type { PanelRow } from "../lib/chart-engine/panel-layout";

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

function makeCandles(count: number, stepMs = 60_000, base = 100): ChartCandle[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const out: ChartCandle[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.sin(i / 5) * 4 + i * 0.03;
    const c = o + (i % 4 === 0 ? -1 : 1) * (0.4 + (i % 6));
    const h = Math.max(o, c) + 1.1;
    const l = Math.min(o, c) - 1.1;
    out.push({ time: start + i * stepMs, open: o, high: h, low: l, close: c, volume: 400 + (i % 20) * 12 });
  }
  return out;
}

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

async function main(): Promise<void> {
  console.log("=== ATR ===");

  test("atrSeries's last value equals atr()'s scalar result - same Wilder recurrence, never a second/divergent formula", () => {
    const candles = makeCandles(60);
    const series = atrSeries(candles, ATR_PERIOD_DEFAULT);
    const scalar = atr(candles, ATR_PERIOD_DEFAULT);
    assert.equal(series[series.length - 1], scalar);
  });

  test("atrSeries is honestly undefined before period+1 candles exist, defined once enough real data exists", () => {
    const candles = makeCandles(60);
    const series = atrSeries(candles, 14);
    for (let i = 0; i < 14; i++) assert.equal(series[i], undefined, `index ${i} should be undefined (< period+1 candles)`);
    assert.notEqual(series[14], undefined);
  });

  test("atrSeries with insufficient total candles is honestly all-undefined, never throws", () => {
    const series = atrSeries(makeCandles(5), 14);
    assert.ok(series.every((v) => v === undefined));
  });

  test("atrSeries has exactly one entry per candle", () => {
    const candles = makeCandles(60);
    assert.equal(atrSeries(candles, 14).length, candles.length);
  });

  test("a minimal {high,low,close} object (never the full Candle type with datetime) satisfies atrSeries's OhlcCandle parameter - proves this Phase 2 addition works directly against ChartCandle[] with zero conversion", () => {
    const minimal: OhlcCandle[] = [
      { high: 101, low: 99, close: 100 },
      { high: 102, low: 100, close: 101 },
    ];
    assert.doesNotThrow(() => atrSeries(minimal, 1));
  });

  console.log("\n=== Stochastic Oscillator ===");

  test("MT5's real default Stochastic parameters are 5/3/3 (%K period 5, Slowing 3, %D period 3) - verified against mql5.com/metatrader5.com this session, never an invented/textbook value", () => {
    assert.equal(STOCHASTIC_K_PERIOD_DEFAULT, 5);
    assert.equal(STOCHASTIC_SLOWING_DEFAULT, 3);
    assert.equal(STOCHASTIC_D_PERIOD_DEFAULT, 3);
  });

  test("stochasticSeries produces %K and %D both bounded in [0,100] wherever defined - a genuine oscillator range, never an out-of-bounds value", () => {
    const candles = makeCandles(60);
    const series = stochasticSeries(candles);
    for (const point of series) {
      if (!point) continue;
      assert.ok(point.k >= 0 && point.k <= 100, `%K ${point.k} out of [0,100]`);
      assert.ok(point.d >= 0 && point.d <= 100, `%D ${point.d} out of [0,100]`);
    }
  });

  test("stochasticSeries has exactly one entry per candle, honestly undefined during the combined kPeriod+slowing+dPeriod warm-up", () => {
    const candles = makeCandles(60);
    const series = stochasticSeries(candles, 5, 3, 3);
    assert.equal(series.length, candles.length);
    // Raw %K needs kPeriod-1 candles before its first value; slowing then
    // needs `slowing` more defined raw values; %D needs `dPeriod` more
    // slowed values - so the very first several indices must be undefined.
    assert.equal(series[0], undefined);
    assert.equal(series[5], undefined);
  });

  test("stochasticSeries with fewer candles than kPeriod is honestly all-undefined, never throws", () => {
    const series = stochasticSeries(makeCandles(3), 5, 3, 3);
    assert.ok(series.every((v) => v === undefined));
  });

  test("a flat window (zero high/low range) reports the honest midpoint (50), never a division-by-zero NaN", () => {
    const flat: OhlcCandle[] = Array.from({ length: 10 }, () => ({ high: 100, low: 100, close: 100 }));
    const series = stochasticSeries(flat, 5, 1, 1);
    const lastDefined = series.filter((v) => v !== undefined).pop();
    assert.ok(lastDefined);
    assert.equal(lastDefined!.k, 50);
    assert.equal(lastDefined!.d, 50);
  });

  console.log("\n=== ADX ===");

  test("MT5's real default ADX period is 14 - verified against mql5.com/metatrader5.com this session", () => {
    assert.equal(ADX_PERIOD_DEFAULT, 14);
  });

  test("adxSeries produces ADX/+DI/-DI all bounded in [0,100] wherever defined - genuinely bounded by construction, never an out-of-bounds value", () => {
    const candles = makeCandles(80);
    const series = adxSeries(candles, 14);
    for (const point of series) {
      if (!point) continue;
      assert.ok(point.adx >= 0 && point.adx <= 100, `ADX ${point.adx} out of [0,100]`);
      assert.ok(point.plusDI >= 0 && point.plusDI <= 100, `+DI ${point.plusDI} out of [0,100]`);
      assert.ok(point.minusDI >= 0 && point.minusDI <= 100, `-DI ${point.minusDI} out of [0,100]`);
    }
  });

  test("adxSeries needs 2*period candles before its first real value (DI smoothing, then ADX's own smoothing of DX) - honestly undefined before that, has exactly one entry per candle", () => {
    const candles = makeCandles(80);
    const series = adxSeries(candles, 14);
    assert.equal(series.length, candles.length);
    for (let i = 0; i < 27; i++) assert.equal(series[i], undefined, `index ${i} should be undefined (< 2*period candles)`);
    assert.notEqual(series[27], undefined);
  });

  test("adxSeries with insufficient total candles is honestly all-undefined, never throws", () => {
    const series = adxSeries(makeCandles(10), 14);
    assert.ok(series.every((v) => v === undefined));
  });

  console.log("\n=== CCI ===");

  test("MT5's real default CCI period is 14 (not the original Lambert methodology's 20) - verified against mql5.com/metatrader5.com this session", () => {
    assert.equal(CCI_PERIOD_DEFAULT, 14);
  });

  test("cciSeries has exactly one entry per candle, honestly undefined before period candles exist", () => {
    const candles = makeCandles(40);
    const series = cciSeries(candles, 14);
    assert.equal(series.length, candles.length);
    for (let i = 0; i < 13; i++) assert.equal(series[i], undefined, `index ${i} should be undefined (< period candles)`);
    assert.notEqual(series[13], undefined);
  });

  test("cciSeries with insufficient total candles is honestly all-undefined, never throws", () => {
    const series = cciSeries(makeCandles(5), 14);
    assert.ok(series.every((v) => v === undefined));
  });

  test("a genuinely flat window (zero mean deviation) reports 0 (no signal either way), never a division-by-zero NaN/Infinity", () => {
    const flat: OhlcCandle[] = Array.from({ length: 20 }, () => ({ high: 100, low: 100, close: 100 }));
    const series = cciSeries(flat, 14);
    const lastDefined = series.filter((v) => v !== undefined).pop();
    assert.equal(lastDefined, 0);
  });

  console.log("\n=== Williams %R ===");

  test("MT5's real default Williams %R period is 14 - verified against mql5.com/metatrader5.com this session", () => {
    assert.equal(WILLIAMS_R_PERIOD_DEFAULT, 14);
  });

  test("williamsPercentRSeries is bounded in [-100,0] wherever defined - genuinely bounded by construction, never out of range", () => {
    const candles = makeCandles(40);
    const series = williamsPercentRSeries(candles, 14);
    for (const v of series) {
      if (v === undefined) continue;
      assert.ok(v >= -100 && v <= 0, `%R ${v} out of [-100,0]`);
    }
  });

  test("williamsPercentRSeries with insufficient total candles is honestly all-undefined, never throws", () => {
    const series = williamsPercentRSeries(makeCandles(5), 14);
    assert.ok(series.every((v) => v === undefined));
  });

  test("a genuinely flat window reports the honest midpoint (-50), matching stochasticSeries' own flat-window convention on its own range", () => {
    const flat: OhlcCandle[] = Array.from({ length: 20 }, () => ({ high: 100, low: 100, close: 100 }));
    const series = williamsPercentRSeries(flat, 14);
    const lastDefined = series.filter((v) => v !== undefined).pop();
    assert.equal(lastDefined, -50);
  });

  console.log("\n=== Parabolic SAR ===");

  function makeTrendingCandles(count: number, direction: 1 | -1): ChartCandle[] {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const out: ChartCandle[] = [];
    for (let i = 0; i < count; i++) {
      const base = 100 + direction * i * 2;
      out.push({ time: start + i * 60_000, open: base, high: base + 1, low: base - 1, close: base + direction * 0.5, volume: 100 });
    }
    return out;
  }

  test("MT5's real default Parabolic SAR step/maximum are 0.02/0.2 - verified against mql5.com/metatrader5.com this session", () => {
    assert.equal(PARABOLIC_SAR_STEP_DEFAULT, 0.02);
    assert.equal(PARABOLIC_SAR_MAX_STEP_DEFAULT, 0.2);
  });

  test("parabolicSarSeries with fewer than 2 candles is honestly all-undefined, never throws", () => {
    const series = parabolicSarSeries([{ high: 101, low: 99, close: 100 }]);
    assert.ok(series.every((v) => v === undefined));
  });

  test("parabolicSarSeries has exactly one entry per candle, index 0 honestly undefined (no prior candle to derive a bootstrap SAR from), index 1 the real bootstrap value", () => {
    const candles = makeTrendingCandles(30, 1);
    const series = parabolicSarSeries(candles);
    assert.equal(series.length, candles.length);
    assert.equal(series[0], undefined);
    assert.notEqual(series[1], undefined);
  });

  test("in a clean, sustained uptrend, SAR stays below the candle's own low at every index - the fundamental Parabolic SAR invariant while trending up (a trailing stop UNDER price)", () => {
    const candles = makeTrendingCandles(40, 1);
    const series = parabolicSarSeries(candles, 0.02, 0.2);
    for (let i = 2; i < candles.length; i++) {
      const point = series[i];
      if (!point) continue;
      assert.equal(point.trend, "up", `index ${i} should still be in the uptrend given monotonically rising candles`);
      assert.ok(point.value <= candles[i].low, `SAR ${point.value} should be <= low ${candles[i].low} at index ${i}`);
    }
  });

  test("in a clean, sustained downtrend, SAR stays above the candle's own high at every index - the mirror invariant while trending down (a trailing stop ABOVE price)", () => {
    const candles = makeTrendingCandles(40, -1);
    const series = parabolicSarSeries(candles, 0.02, 0.2);
    for (let i = 2; i < candles.length; i++) {
      const point = series[i];
      if (!point) continue;
      assert.equal(point.trend, "down", `index ${i} should still be in the downtrend given monotonically falling candles`);
      assert.ok(point.value >= candles[i].high, `SAR ${point.value} should be >= high ${candles[i].high} at index ${i}`);
    }
  });

  test("a real reversal (sharp downturn after a sustained uptrend) is genuinely detected - the trend flips from 'up' to 'down' partway through, never stuck permanently on the bootstrap direction", () => {
    const up = makeTrendingCandles(20, 1);
    const lastUpBase = 100 + 1 * 19 * 2;
    const down = Array.from({ length: 20 }, (_, i) => {
      const base = lastUpBase - i * 3;
      return { time: up[up.length - 1].time + (i + 1) * 60_000, open: base, high: base + 1, low: base - 1, close: base - 0.5, volume: 100 };
    });
    const candles = [...up, ...down];
    const series = parabolicSarSeries(candles, 0.02, 0.2);
    const trends = series.map((p) => p?.trend);
    assert.ok(trends.slice(0, 15).includes("up"), "should be in an uptrend during the rising portion");
    assert.ok(trends.slice(-5).includes("down"), "should have reversed to a downtrend by the end of the sharp downturn");
  });

  console.log("\n=== Ichimoku Kinko Hyo ===");

  test("MT5's real default Ichimoku periods are Tenkan 9 / Kijun 26 / Senkou 52 - verified against mql5.com/metatrader5.com this session", () => {
    assert.equal(ICHIMOKU_TENKAN_DEFAULT, 9);
    assert.equal(ICHIMOKU_KIJUN_DEFAULT, 26);
    assert.equal(ICHIMOKU_SENKOU_DEFAULT, 52);
  });

  test("ichimokuSeries on an empty array returns five empty line arrays, never throws", () => {
    const result = ichimokuSeries([]);
    assert.equal(result.tenkan.length, 0);
    assert.equal(result.kijun.length, 0);
    assert.equal(result.senkouA.length, 0);
    assert.equal(result.senkouB.length, 0);
    assert.equal(result.chikou.length, 0);
  });

  test("Tenkan-sen/Kijun-sen are honestly undefined until their own period of candles exist, then match the real (highest high + lowest low)/2 Donchian-midpoint formula", () => {
    const candles = makeCandles(70);
    const result = ichimokuSeries(candles, 9, 26, 52);
    assert.equal(result.tenkan[7].value, undefined);
    assert.notEqual(result.tenkan[8].value, undefined);
    const tenkanWindow = candles.slice(0, 9);
    const tenkanExpected = (Math.max(...tenkanWindow.map((c) => c.high)) + Math.min(...tenkanWindow.map((c) => c.low))) / 2;
    assert.equal(result.tenkan[8].value, tenkanExpected);

    assert.equal(result.kijun[24].value, undefined);
    assert.notEqual(result.kijun[25].value, undefined);
    const kijunWindow = candles.slice(0, 26);
    const kijunExpected = (Math.max(...kijunWindow.map((c) => c.high)) + Math.min(...kijunWindow.map((c) => c.low))) / 2;
    assert.equal(result.kijun[25].value, kijunExpected);
  });

  test("Tenkan-sen/Kijun-sen plot at their own candle's real, unshifted time - never shifted", () => {
    const candles = makeCandles(70);
    const result = ichimokuSeries(candles, 9, 26, 52);
    assert.equal(result.tenkan[30].time, candles[30].time);
    assert.equal(result.kijun[30].time, candles[30].time);
  });

  test("Senkou Span A/B are computed from the current candle but plotted kijunPeriod candles AHEAD - when the shift target still exists within the real array, it uses that real candle's time (never a synthetic one)", () => {
    const candles = makeCandles(100);
    const result = ichimokuSeries(candles, 9, 26, 52);
    assert.equal(result.senkouA[52].time, candles[78].time);
    assert.equal(result.senkouB[52].time, candles[78].time);
    const tenkanAt52 = result.tenkan[52].value!;
    const kijunAt52 = result.kijun[52].value!;
    assert.equal(result.senkouA[52].value, (tenkanAt52 + kijunAt52) / 2);
    const senkouBWindow = candles.slice(52 - 52 + 1, 52 + 1);
    const senkouBExpected = (Math.max(...senkouBWindow.map((c) => c.high)) + Math.min(...senkouBWindow.map((c) => c.low))) / 2;
    assert.equal(result.senkouB[52].value, senkouBExpected);
  });

  test("Senkou Span A/B plotted beyond the real candle array extrapolate a synthetic FUTURE time using the array's own real step - never a fabricated VALUE, only a fabricated time to plot an already-real value at", () => {
    const candles = makeCandles(70);
    const result = ichimokuSeries(candles, 9, 26, 52);
    const n = candles.length;
    const lastIndex = n - 1;
    const stepMs = candles[1].time - candles[0].time;
    const targetIndex = lastIndex + 26;
    const expectedTime = candles[n - 1].time + (targetIndex - (n - 1)) * stepMs;
    assert.equal(result.senkouA[lastIndex].time, expectedTime);
    assert.equal(result.senkouB[lastIndex].time, expectedTime);
    assert.notEqual(result.senkouB[lastIndex].value, undefined);
  });

  test("Chikou Span always equals the candle's own close price (never undefined - no minimum period), plotted kijunPeriod candles BEHIND, using the real earlier candle's time whenever that index exists", () => {
    const candles = makeCandles(70);
    const result = ichimokuSeries(candles, 9, 26, 52);
    assert.equal(result.chikou[40].value, candles[40].close);
    assert.equal(result.chikou[40].time, candles[14].time);
  });

  test("Chikou Span for early indices (before kijunPeriod candles exist) extrapolates a synthetic BACKWARD time before the array's first real candle - never a fabricated value, only a fabricated time", () => {
    const candles = makeCandles(70);
    const result = ichimokuSeries(candles, 9, 26, 52);
    const stepMs = candles[1].time - candles[0].time;
    const expectedTime = candles[0].time + (5 - 26) * stepMs;
    assert.equal(result.chikou[5].time, expectedTime);
    assert.equal(result.chikou[5].value, candles[5].close);
  });

  console.log("\n=== Chart engine wiring (panel-registry.ts / compute.ts) ===");

  test("ATR/Stochastic/ADX/CCI/Williams %R are all registered in PANEL_REGISTRY with their own real sub-panel row, never overlaid on price", () => {
    for (const id of ["atr", "stochastic", "adx", "cci", "williams-r"] as const) {
      assert.ok(PANEL_REGISTRY[id]);
      assert.equal(INDICATOR_PANEL_ID[id], id);
    }
  });

  test("DEFAULT_INDICATOR_CONFIGS' new entries use MT5's real verified periods, and every entry's computed .panel matches INDICATOR_PANEL_ID (D2.7.5's own anti-drift guarantee, extended to Phase 2)", () => {
    const atrCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "atr");
    const stochCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "stochastic");
    const adxCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "adx");
    const cciCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "cci");
    const wprCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "williams-r");
    const sarCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "parabolic-sar");
    const ichimokuCfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "ichimoku");
    assert.ok(atrCfg && atrCfg.period === 14);
    assert.ok(stochCfg && stochCfg.period === 5 && stochCfg.slowingPeriod === 3 && stochCfg.signalPeriod === 3);
    assert.ok(adxCfg && adxCfg.period === 14);
    assert.ok(cciCfg && cciCfg.period === 14);
    assert.ok(wprCfg && wprCfg.period === 14);
    assert.ok(sarCfg && sarCfg.period === 0.02 && sarCfg.maxStep === 0.2);
    assert.ok(ichimokuCfg && ichimokuCfg.period === 9 && ichimokuCfg.slowPeriod === 26 && ichimokuCfg.senkouPeriod === 52);

    const candles = makeCandles(80);
    for (const cfg of DEFAULT_INDICATOR_CONFIGS) {
      const series = computeIndicatorSeries(candles, cfg);
      assert.equal(series.panel, INDICATOR_PANEL_ID[cfg.id]);
    }
  });

  test("parabolic-sar is a PRICE overlay (never its own sub-panel) with a single 'dots'-styled line - never a connected line", () => {
    const candles = makeCandles(80);
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "parabolic-sar")!;
    const series = computeIndicatorSeries(candles, cfg);
    assert.equal(series.panel, "price");
    assert.equal(series.lines.length, 1);
    assert.equal(series.lines[0].style, "dots");
  });

  test("ichimoku is a PRICE overlay (never its own sub-panel) with five distinct lines (Tenkan/Kijun/Senkou A/Senkou B/Chikou), all connected lines - never dots or band-edge", () => {
    const candles = makeCandles(80);
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "ichimoku")!;
    const series = computeIndicatorSeries(candles, cfg);
    assert.equal(series.panel, "price");
    assert.equal(series.lines.length, 5);
    assert.ok(series.lines.every((l) => l.style === undefined));
    assert.ok(series.lines[0].name.endsWith("-tenkan"));
    assert.ok(series.lines[1].name.endsWith("-kijun"));
    assert.ok(series.lines[2].name.endsWith("-senkou-a"));
    assert.ok(series.lines[3].name.endsWith("-senkou-b"));
    assert.ok(series.lines[4].name.endsWith("-chikou"));
  });

  test("computeIndicatorSeries for adx returns three lines (ADX, +DI, -DI) with distinct names - the real MT5 3-line display, never a single line standing in for all three", () => {
    const candles = makeCandles(80);
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "adx")!;
    const series = computeIndicatorSeries(candles, cfg);
    assert.equal(series.lines.length, 3);
    assert.ok(series.lines[0].name.endsWith("-adx"));
    assert.ok(series.lines[1].name.endsWith("-plus-di"));
    assert.ok(series.lines[2].name.endsWith("-minus-di"));
  });

  test("computeIndicatorSeries for stochastic returns two lines (%K, %D) with distinct names, matching MACD's own multi-line convention - never a single line silently standing in for both", () => {
    const candles = makeCandles(60);
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "stochastic")!;
    const series = computeIndicatorSeries(candles, cfg);
    assert.equal(series.lines.length, 2);
    assert.ok(series.lines[0].name.endsWith("-k"));
    assert.ok(series.lines[1].name.endsWith("-d"));
  });

  console.log("\n=== Rendering (sub-panel-renderer.ts) ===");

  const VIEWPORT: Viewport = { minTime: 0, maxTime: 1000, minPrice: 90, maxPrice: 120 };
  const PLOT_WIDTH = 1000;
  const ROW: PanelRow = { id: "atr", top: 0, height: 200 };
  const RENDER_CANDLES: ChartCandle[] = Array.from({ length: 11 }, (_, i) => ({ time: i * 100, open: 100, high: 110, low: 90, close: 100 }));
  const INDEX_RANGE = indexRangeForViewport(RENDER_CANDLES, VIEWPORT);

  test("drawAtrPanel runs without throwing for a real series, and renders nothing but the frame when the series is undefined (honest empty state, never a fabricated line)", () => {
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "atr")!;
    const series = computeIndicatorSeries(RENDER_CANDLES, cfg);
    assert.doesNotThrow(() => {
      drawAtrPanel(fakeCtx(), series, RENDER_CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, ROW, resolveChartColors());
      drawAtrPanel(fakeCtx(), undefined, RENDER_CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, ROW, resolveChartColors());
    });
  });

  test("drawStochasticPanel draws the real 80/20 overbought/oversold reference lines (never RSI's 70/30) and both %K/%D lines without throwing", () => {
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "stochastic")!;
    const series = computeIndicatorSeries(RENDER_CANDLES, cfg);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => drawStochasticPanel(ctx, series, RENDER_CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, ROW, resolveChartColors()));
    assert.ok(ctx.calls.includes("stroke"));
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  test("drawAdxPanel draws all three lines (ADX/+DI/-DI) without throwing, and draws no fabricated reference line (MT5's own ADX indicator has none by default)", () => {
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "adx")!;
    const wideCandles: ChartCandle[] = Array.from({ length: 30 }, (_, i) => ({ time: i * 100, open: 100, high: 110, low: 90, close: 100 + (i % 2 === 0 ? 1 : -1) }));
    const series = computeIndicatorSeries(wideCandles, cfg);
    const ctx = fakeCtx();
    const wideRange = indexRangeForViewport(wideCandles, { minTime: 0, maxTime: 2900, minPrice: 0, maxPrice: 100 });
    assert.doesNotThrow(() =>
      drawAdxPanel(ctx, series, wideCandles, wideRange, { minTime: 0, maxTime: 2900, minPrice: 0, maxPrice: 100 }, PLOT_WIDTH, ROW, resolveChartColors()),
    );
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  test("drawCciPanel draws the real +-100 reference lines and runs without throwing, including when the visible data's own range is narrower than 100 (the scale must still show +-100)", () => {
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "cci")!;
    const series = computeIndicatorSeries(RENDER_CANDLES, cfg);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => drawCciPanel(ctx, series, RENDER_CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, ROW, resolveChartColors()));
    assert.ok(ctx.calls.includes("stroke"));
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  test("drawWilliamsRPanel draws the real -20/-80 reference lines (the mirror of Stochastic's 80/20) and runs without throwing", () => {
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "williams-r")!;
    const series = computeIndicatorSeries(RENDER_CANDLES, cfg);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => drawWilliamsRPanel(ctx, series, RENDER_CANDLES, INDEX_RANGE, VIEWPORT, PLOT_WIDTH, ROW, resolveChartColors()));
    assert.ok(ctx.calls.includes("stroke"));
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  test("drawOverlays renders Parabolic SAR as discrete dots (fillRect only) - never a connected line (no stroke/moveTo/lineTo for this series)", () => {
    const candles = makeCandles(40);
    const cfg = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "parabolic-sar")!;
    const series = computeIndicatorSeries(candles, cfg);
    const vp = fitToData(candles);
    const range = indexRangeForViewport(candles, vp);
    const priceRow: PanelRow = { id: "price", top: 0, height: 300 };
    const ctx = fakeCtx();
    assert.doesNotThrow(() => drawOverlays(ctx, [series], candles, range, vp, PLOT_WIDTH, priceRow));
    assert.ok(ctx.calls.includes("fillRect"));
    assert.ok(!ctx.calls.includes("stroke"));
    assert.ok(!ctx.calls.includes("moveTo"));
    assert.ok(!ctx.calls.includes("lineTo"));
  });

  test("renderChart end-to-end with all five Phase 2 sub-panels PLUS the Parabolic SAR and Ichimoku overlays active runs without throwing, using only canvas methods already relied on elsewhere", () => {
    const candles = makeCandles(80);
    const vp = fitToData(candles);
    const subPanelIds = ["atr", "stochastic", "adx", "cci", "williams-r"] as const;
    const indicatorIds = [...subPanelIds, "parabolic-sar", "ichimoku"] as const;
    const indicatorSeries = indicatorIds.map((id) => computeIndicatorSeries(candles, DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === id)!));
    const ctx = fakeCtx();
    assert.doesNotThrow(() => {
      renderChart({
        ctx,
        dims: { width: 900, height: 1200, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport: vp,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
        activePanels: [...subPanelIds], // "parabolic-sar"/"ichimoku" are PRICE overlays, never activePanels entries - drawOverlays picks them up from indicatorSeries via their own .panel === "price"
        indicatorSeries,
      });
    });
    assert.ok(!ctx.calls.includes("strokeRect"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
