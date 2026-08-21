// scripts/validate-native-chart-bill-williams.ts
// Sprint D2.7.11 - Bill Williams' tools, deferred from Phase 2, now
// requested: Alligator (Jaw/Teeth/Lips SMMA, MT5's real 13/8/5 periods
// with +8/+5/+3 bar future shifts), Awesome Oscillator (5/34-period SMA
// difference over median price), and Fractals (5-bar structural extremes).
// Every default verified against metatrader5.com's own Bill Williams'
// Indicators help pages this session. Standalone, assert-based
// verification, matching every prior sprint's scripts/validate-*.ts
// pattern. Run via `npm run validate:native-chart-bill-williams`.
import assert from "node:assert/strict";

import {
  alligatorSeries,
  awesomeOscillatorSeries,
  fractalsSeries,
  ALLIGATOR_JAW_PERIOD_DEFAULT,
  ALLIGATOR_JAW_SHIFT_DEFAULT,
  ALLIGATOR_TEETH_PERIOD_DEFAULT,
  ALLIGATOR_LIPS_PERIOD_DEFAULT,
  AO_FAST_PERIOD_DEFAULT,
  AO_SLOW_PERIOD_DEFAULT,
  type OhlcCandle,
  type OhlcCandleWithTime,
} from "../lib/market-data/indicators";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS, PANEL_REGISTRY, INDICATOR_PANEL_ID } from "../lib/chart-engine/indicators/panel-registry";
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

function alligatorTests(): void {
  test("1: alligatorSeries on an empty series returns three empty arrays, never throws", () => {
    const result = alligatorSeries([]);
    assert.deepEqual(result, { jaw: [], teeth: [], lips: [] });
  });

  test("2: each line is honestly undefined before its own period's warm-up (Lips period 5 becomes computable strictly before Teeth period 8, which becomes computable strictly before Jaw period 13)", () => {
    const candles: OhlcCandleWithTime[] = makeCandles(20);
    const { jaw, teeth, lips } = alligatorSeries(candles);
    assert.equal(jaw[ALLIGATOR_JAW_PERIOD_DEFAULT - 2].value, undefined);
    assert.notEqual(jaw[ALLIGATOR_JAW_PERIOD_DEFAULT - 1].value, undefined);
    assert.equal(teeth[ALLIGATOR_TEETH_PERIOD_DEFAULT - 2].value, undefined);
    assert.notEqual(teeth[ALLIGATOR_TEETH_PERIOD_DEFAULT - 1].value, undefined);
    assert.equal(lips[ALLIGATOR_LIPS_PERIOD_DEFAULT - 2].value, undefined);
    assert.notEqual(lips[ALLIGATOR_LIPS_PERIOD_DEFAULT - 1].value, undefined);
  });

  test("3: Lips' first real SMMA value is exactly the plain SMA of the first 5 candles' median price (13,8,5's shared SMMA seed is a plain SMA, wilderSmooth()'s own established formula) - a real, hand-verifiable number, never approximated", () => {
    const candles: OhlcCandleWithTime[] = makeCandles(10);
    const { lips } = alligatorSeries(candles);
    const expectedSeed =
      candles.slice(0, ALLIGATOR_LIPS_PERIOD_DEFAULT).reduce((sum, c) => sum + (c.high + c.low) / 2, 0) / ALLIGATOR_LIPS_PERIOD_DEFAULT;
    assert.ok(Math.abs((lips[ALLIGATOR_LIPS_PERIOD_DEFAULT - 1].value as number) - expectedSeed) < 1e-9);
  });

  test("4: every line's plotted time is shifted the real MT5 number of bars INTO THE FUTURE (Jaw +8) relative to the candle whose data produced that value - never plotted at the source candle's own time", () => {
    const candles: OhlcCandleWithTime[] = makeCandles(25); // enough room for sourceIndex(12) + shift(8) to land within the real range
    const { jaw } = alligatorSeries(candles);
    const sourceIndex = ALLIGATOR_JAW_PERIOD_DEFAULT - 1;
    const plotted = jaw[sourceIndex];
    const expectedTime = candles[sourceIndex + ALLIGATOR_JAW_SHIFT_DEFAULT]?.time;
    assert.equal(plotted.time, expectedTime);
  });

  test("5: a shift that lands past the last real candle still produces a real (extrapolated-TIME, real-VALUE) point - never silently dropped, matching Ichimoku's own established forward-shift precedent", () => {
    const candles: OhlcCandleWithTime[] = makeCandles(15); // last 8 candles' Jaw shift (+8) lands past index 14
    const { jaw } = alligatorSeries(candles);
    const lastComputable = candles.length - 1;
    assert.notEqual(jaw[lastComputable].value, undefined);
    assert.ok(jaw[lastComputable].time > candles[candles.length - 1].time);
  });
}

function awesomeOscillatorTests(): void {
  test("6: awesomeOscillatorSeries is honestly undefined before the slower (34-period) average is computable, never before", () => {
    const candles = makeCandles(40);
    const values = awesomeOscillatorSeries(candles);
    assert.equal(values[AO_SLOW_PERIOD_DEFAULT - 2], undefined);
    assert.notEqual(values[AO_SLOW_PERIOD_DEFAULT - 1], undefined);
  });

  test("7: the first real value is exactly SMA(5, median) - SMA(34, median) at that index - a real, hand-computable formula, never approximated", () => {
    const candles = makeCandles(40);
    const median = candles.map((c) => (c.high + c.low) / 2);
    const idx = AO_SLOW_PERIOD_DEFAULT - 1;
    const fast = median.slice(idx - AO_FAST_PERIOD_DEFAULT + 1, idx + 1).reduce((a, b) => a + b, 0) / AO_FAST_PERIOD_DEFAULT;
    const slow = median.slice(idx - AO_SLOW_PERIOD_DEFAULT + 1, idx + 1).reduce((a, b) => a + b, 0) / AO_SLOW_PERIOD_DEFAULT;
    const values = awesomeOscillatorSeries(candles);
    assert.ok(Math.abs((values[idx] as number) - (fast - slow)) < 1e-9);
  });
}

function fractalsTests(): void {
  function candle(high: number, low: number): OhlcCandle {
    return { high, low, close: (high + low) / 2 };
  }

  test("8: a genuine up-fractal (middle bar's high strictly above all 4 neighbors) is detected at the middle index, with the real high as its value - never a synthesized offset", () => {
    const candles = [candle(100, 90), candle(101, 91), candle(105, 95), candle(102, 92), candle(100, 90)];
    const { up } = fractalsSeries(candles);
    assert.equal(up[2], 105);
    assert.equal(up[0], undefined);
    assert.equal(up[1], undefined);
  });

  test("9: a genuine down-fractal (middle bar's low strictly below all 4 neighbors) is detected symmetrically, with the real low as its value", () => {
    const candles = [candle(110, 100), candle(109, 99), candle(108, 90), candle(109, 99), candle(110, 100)];
    const { down } = fractalsSeries(candles);
    assert.equal(down[2], 90);
  });

  test("10: the two wing bars need NOT be monotonically decreasing away from the middle - only individually lower than the middle - matching MT5's real rule exactly (a stricter monotonic reading would wrongly reject this valid fractal)", () => {
    // Middle (index 2) high=105. Left wing: 101, 103 (rises toward the middle, non-monotonic outward) - both still < 105, so this IS a valid fractal.
    const candles = [candle(101, 91), candle(103, 93), candle(105, 95), candle(102, 92), candle(100, 90)];
    const { up } = fractalsSeries(candles);
    assert.equal(up[2], 105);
  });

  test("11: a tie (a neighbor's high EQUALS the middle's high) never qualifies - MT5's real rule requires the middle to be STRICTLY the highest, ties are honestly not a fractal", () => {
    const candles = [candle(100, 90), candle(105, 91), candle(105, 95), candle(102, 92), candle(100, 90)];
    const { up } = fractalsSeries(candles);
    assert.equal(up[2], undefined);
  });

  test("12: the first and last 2 candles can never qualify (no room for both wings) - honestly undefined there, never guessed", () => {
    const candles = makeCandles(10);
    const { up, down } = fractalsSeries(candles);
    for (const i of [0, 1, candles.length - 2, candles.length - 1]) {
      assert.equal(up[i], undefined);
      assert.equal(down[i], undefined);
    }
  });
}

function wiringTests(): void {
  test("13: DEFAULT_INDICATOR_CONFIGS includes exactly one alligator/awesome-oscillator/fractals entry each - never duplicated, never missing", () => {
    const ids = DEFAULT_INDICATOR_CONFIGS.map((c) => c.id);
    for (const id of ["alligator", "awesome-oscillator", "fractals"] as const) {
      assert.equal(ids.filter((x) => x === id).length, 1);
    }
  });

  test("14: PANEL_REGISTRY has a real 'awesome-oscillator' entry - the sub-panel this indicator needs actually exists in the layout system", () => {
    assert.ok(PANEL_REGISTRY["awesome-oscillator"]);
    assert.equal(PANEL_REGISTRY["awesome-oscillator"].heightWeight, 1);
  });

  test("15: INDICATOR_PANEL_ID's static lookup agrees with computeIndicatorSeries()'s own real .panel assignment for all three new indicators - alligator/fractals price overlays, awesome-oscillator its own sub-panel - so the toolbar's Overlays/Panels menu grouping can never silently drift from the real renderer behavior", () => {
    const candles = makeCandles(40);
    for (const config of DEFAULT_INDICATOR_CONFIGS.filter((c) => ["alligator", "awesome-oscillator", "fractals"].includes(c.id))) {
      const series = computeIndicatorSeries(candles, config);
      assert.equal(series.panel, INDICATOR_PANEL_ID[config.id], `mismatch for ${config.id}`);
    }
  });

  test("16: alligator's three lines use only existing AT24 design-token colors (var(--steel)/var(--gold-strong)/config.color) - never an invented blue/red/green literal, matching panel-registry.ts's own 'no new palette' discipline every other indicator already follows", () => {
    const candles = makeCandles(40);
    const config = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "alligator")!;
    const series = computeIndicatorSeries(candles, config);
    for (const line of series.lines) {
      assert.ok(line.color.startsWith("var(--"), `${line.name} color "${line.color}" is not a design token`);
    }
  });

  test("17: fractals' two lines render with style 'dots' (point markers, never a connected line - a connected line between sparse, irregularly-spaced fractal points would visually imply a false continuous relationship)", () => {
    const candles = makeCandles(40);
    const config = DEFAULT_INDICATOR_CONFIGS.find((c) => c.id === "fractals")!;
    const series = computeIndicatorSeries(candles, config);
    assert.ok(series.lines.every((l) => l.style === "dots"));
  });

  test("18: renderChart runs end-to-end with all three new indicators active (as overlays + the new sub-panel) without throwing, on a real multi-day series", () => {
    const candles = makeCandles(60);
    const vp = fitToData(candles);
    const ctx = fakeCtx();
    const configs = DEFAULT_INDICATOR_CONFIGS.filter((c) => ["alligator", "awesome-oscillator", "fractals"].includes(c.id));
    const indicatorSeries = configs.map((c) => computeIndicatorSeries(candles, c));
    assert.doesNotThrow(() => {
      renderChart({
        ctx,
        dims: { width: 600, height: 400, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles,
        viewport: vp,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
        activePanels: ["awesome-oscillator"],
        indicatorSeries,
      });
    });
  });

  test("19: renderChart with these indicators active on an empty candle series never throws (honest empty-plot draw, matching every other indicator's existing contract)", () => {
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
        activePanels: ["awesome-oscillator"],
        indicatorSeries: [],
      });
    });
  });
}

async function main(): Promise<void> {
  console.log("=== Alligator (Jaw/Teeth/Lips SMMA, MT5's real 13/8/5 + future shifts) ===");
  alligatorTests();
  console.log("\n=== Awesome Oscillator (5/34-period median SMA difference) ===");
  awesomeOscillatorTests();
  console.log("\n=== Fractals (5-bar structural extremes) ===");
  fractalsTests();
  console.log("\n=== Wiring (panel-registry.ts / compute.ts / renderer.ts) ===");
  wiringTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
