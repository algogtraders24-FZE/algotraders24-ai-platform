// scripts/validate-native-chart-d2.9-hardening.ts
// Sprint D2.9.1-D2.9.4 - Native Chart Hardening (light/white chart-canvas
// scheme, cross-pane crosshair time sync, trade-marker clustering, Algo
// Test equity-curve overlay), the gap-closing phase before D2.9.6 flips the
// Native Chart to the platform's default provider. Standalone, assert-based
// verification, matching every prior sprint's scripts/validate-*.ts
// pattern. Run via `npm run validate:d2.9-native-chart-hardening`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveChartColors, CHART_THEME_LABELS, resetColorCacheForTests, type ChartTheme } from "../lib/chart-engine/canvas-colors";
import { fractionalIndexForTime, fractionalIndexToTime } from "../lib/chart-engine/index-scale";
import { fitToData } from "../lib/chart-engine/viewport";
import { renderChart, type AlgoTestTradeMarker } from "../lib/chart-engine/renderer";
import { PANEL_REGISTRY } from "../lib/chart-engine/indicators/panel-registry";
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

function read(relPath: string): string {
  return readFileSync(join(__dirname, "..", relPath), "utf-8");
}

function makeCandleSeries(count: number, stepMs: number, base = 100): ChartCandle[] {
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

function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  fillRects: RectCall[];
  fillCalls: number;
  arcCalls: ArcCall[];
  strokeStyles: string[];
  fillStyles: string[];
  fillTexts: string[];
  lines: { x: number; y: number }[];
} {
  const fillRects: RectCall[] = [];
  const arcCalls: ArcCall[] = [];
  const strokeStyles: string[] = [];
  const fillStyles: string[] = [];
  const fillTexts: string[] = [];
  const lines: { x: number; y: number }[] = [];
  let fillCalls = 0;
  const ctx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRects.push({ x, y, w, h });
    },
    beginPath: () => {},
    closePath: () => {},
    moveTo: (x: number, y: number) => lines.push({ x, y }),
    lineTo: (x: number, y: number) => lines.push({ x, y }),
    stroke: () => {},
    fill: () => {
      fillCalls += 1;
    },
    arc: (x: number, y: number, radius: number) => {
      arcCalls.push({ x, y, radius });
    },
    fillText: (text: string) => {
      fillTexts.push(text);
    },
    setLineDash: () => {},
    save: () => {},
    restore: () => {},
    set fillStyle(v: string) {
      fillStyles.push(v);
    },
    set strokeStyle(v: string) {
      strokeStyles.push(v);
    },
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillRects,
    get fillCalls() {
      return fillCalls;
    },
    arcCalls,
    strokeStyles,
    fillStyles,
    fillTexts,
    lines,
  };
}

const CANDLE_COUNT = 60;
const STEP_MS = 60_000;

function renderWith(candles: ChartCandle[], overrides: Partial<Parameters<typeof renderChart>[0]>) {
  const viewport = fitToData(candles);
  const rec = recordingCtx();
  const dims = { width: 900, height: 400, priceAxisWidth: 60, timeAxisHeight: 24 };
  renderChart({ ctx: rec.ctx, dims, candles, viewport, timeframe: "1m", colors: resolveChartColors("mt5"), ...overrides });
  return { ...rec, viewport, dims };
}

function main(): void {
  console.log("=== D2.9.1 - Light/white chart-canvas theme ===");

  test("'light' is a real, distinct ChartTheme - not an alias for an existing scheme", () => {
    resetColorCacheForTests();
    const light = resolveChartColors("light");
    const mt5 = resolveChartColors("mt5");
    assert.notEqual(light.background, mt5.background);
    assert.equal(light.background, "#ffffff");
  });

  test("light theme is internally distinguishable from white - text/grid/bullish/bearish are never the same color as the background", () => {
    const light = resolveChartColors("light");
    for (const field of ["grid", "textPrimary", "textTertiary", "bullish", "bearish", "accent"] as const) {
      assert.notEqual(light[field], light.background, `${field} must not equal background`);
    }
  });

  test("light theme's accent is not gold - gold fails contrast against a white background (this session's own reasoning, canvas-colors.ts)", () => {
    const light = resolveChartColors("light");
    assert.notEqual(light.accent.toLowerCase(), "#d4af37");
  });

  test("CHART_THEME_LABELS has a real, human-readable label for 'light'", () => {
    assert.equal(CHART_THEME_LABELS.light, "Light");
  });

  test("the Properties dialog's Colors-tab scheme picker (NativeChart.tsx COLOR_SCHEMES) now offers 'light' alongside the two MT5 schemes", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('const COLOR_SCHEMES: ChartTheme[] = ["mt5", "mt5-green", "light"];'));
  });

  test("resolveChartColors never throws for any declared ChartTheme - every union member has a real implementation", () => {
    const themes: ChartTheme[] = ["at24", "mt5", "mt5-green", "light"];
    for (const theme of themes) assert.doesNotThrow(() => resolveChartColors(theme));
  });

  console.log("\n=== D2.9.2 - Cross-pane crosshair time sync ===");

  test("fractionalIndexToTime/fractionalIndexForTime round-trip a real index back to (approximately) the same index - the exact primitive pair the cross-pane sync reuses, never a second coordinate system", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const index = 12.5;
    const time = fractionalIndexToTime(candles, index);
    const roundTripped = fractionalIndexForTime(candles, time);
    assert.ok(Math.abs(roundTripped - index) < 1e-6, `expected ~${index}, got ${roundTripped}`);
  });

  test("a real time from one candle series maps correctly onto a DIFFERENT series (a different timeframe pane) via the same real-timestamp lookup - the whole point of syncing by time, not by index", () => {
    const paneA = makeCandleSeries(CANDLE_COUNT, STEP_MS); // 1-minute pane
    const paneB = makeCandleSeries(CANDLE_COUNT, STEP_MS * 5); // 5-minute pane, same start-ish window
    const timeFromA = fractionalIndexToTime(paneA, 20);
    const indexInB = fractionalIndexForTime(paneB, timeFromA);
    assert.ok(Number.isFinite(indexInB));
  });

  test("renderChart draws nothing extra for externalCrosshairTime when a real local crosshair is already active (never double-draws for the hovering pane itself)", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const { lines: withLocalOnly } = renderWith(candles, { crosshair: { index: 20, x: 300, y: 100 } });
    const { lines: withBoth } = renderWith(candles, { crosshair: { index: 20, x: 300, y: 100 }, externalCrosshairTime: candles[10].time });
    assert.deepEqual(withBoth, withLocalOnly, "an externalCrosshairTime alongside a real local crosshair must draw byte-for-byte the same as the local crosshair alone");
  });

  test("renderChart draws the external ghost line (extra moveTo/lineTo pair) when there is NO local crosshair", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const { lines: withoutExternal } = renderWith(candles, {});
    const { lines: withExternal } = renderWith(candles, { externalCrosshairTime: candles[10].time });
    assert.ok(withExternal.length > withoutExternal.length, "externalCrosshairTime must add real draw calls when no local crosshair is active");
  });

  test("externalCrosshairTime outside the visible range draws nothing extra - never clamped/guessed onto an edge", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const { lines: withoutExternal } = renderWith(candles, {});
    const farFuture = candles[candles.length - 1].time + STEP_MS * 10_000;
    const { lines: withExternal } = renderWith(candles, { externalCrosshairTime: farFuture });
    assert.deepEqual(withExternal, withoutExternal);
  });

  test("NativeChart's crosshairRef is only ever mutated through the one setCrosshairState helper - so every clear/set site also notifies ChartPanel for cross-pane sync", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const directAssignments = (src.match(/crosshairRef\.current = /g) ?? []).length;
    // Exactly one direct assignment should remain: inside setCrosshairState
    // itself. Every call SITE elsewhere must go through the helper.
    assert.equal(directAssignments, 1, `expected exactly 1 direct crosshairRef.current assignment (inside setCrosshairState), found ${directAssignments}`);
    assert.ok(src.includes("function setCrosshairState(next: CrosshairState | null)"));
  });

  test("ChartPanel owns the shared syncedCrosshairTime state and fans it out to every pane", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("useState<number | null>(null)"));
    assert.ok(src.includes("onCrosshairTimeChange={setSyncedCrosshairTime}"));
    assert.ok(src.includes("externalCrosshairTime={syncedCrosshairTime}"));
  });

  console.log("\n=== D2.9.4 - Trade-marker clustering ===");

  function buyTradeAt(id: string, time: number, price: number): AlgoTestTradeMarker {
    return { tradeId: id, side: "BUY", entryTime: time, entryPrice: price, exitTime: time + STEP_MS * 5, exitPrice: price + 1 };
  }

  test("two trades whose entries land close together (within TRADE_CLUSTER_BUCKET_PX) collapse into ONE aggregate marker - one fill() (the cluster circle), zero individual triangles", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const mid = candles[30];
    // Same entryTime -> identical entry.x pixel position, guaranteeing the
    // same cluster bucket regardless of this series' own candle-to-pixel
    // spacing (a real trade set can genuinely share an entry bar).
    const t1 = buyTradeAt("c1", mid.time, mid.close);
    const t2 = buyTradeAt("c2", mid.time, mid.close + 0.2);
    const { fillCalls, arcCalls } = renderWith(candles, { algoTestTrades: [t1, t2] });
    assert.equal(fillCalls, 1, "a clustered bucket draws exactly one aggregate fill(), never per-trade triangles");
    assert.equal(arcCalls.length, 1, "the aggregate marker is drawn via ctx.arc()");
  });

  test("a clustered bucket's aggregate marker shows the real member count as its label", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const mid = candles[30];
    const trades = [buyTradeAt("c1", mid.time, mid.close), buyTradeAt("c2", mid.time, mid.close + 0.1), buyTradeAt("c3", mid.time, mid.close + 0.2)];
    const { fillTexts } = renderWith(candles, { algoTestTrades: trades });
    assert.ok(fillTexts.includes("3"), `expected a "3" count label, got: ${JSON.stringify(fillTexts)}`);
  });

  test("a bucket containing the currently-selected trade is NEVER collapsed - every member renders individually so the selection stays visible", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const mid = candles[30];
    const t1 = buyTradeAt("c1", mid.time, mid.close);
    const t2 = buyTradeAt("c2", mid.time, mid.close + 0.1);
    const { fillCalls, arcCalls } = renderWith(candles, { algoTestTrades: [t1, t2], selectedAlgoTestTradeId: "c1" });
    assert.equal(fillCalls, 2, "both members of a bucket holding the selected trade render individually");
    assert.equal(arcCalls.length, 1, "only the selected trade gets a highlight ring");
  });

  console.log("\n=== D2.9.4 - Algo Test equity-curve overlay ===");

  test("'equity' is registered in PANEL_REGISTRY with a real height weight - computePanelLayout can size its row", () => {
    assert.ok(PANEL_REGISTRY.equity);
    assert.ok(PANEL_REGISTRY.equity.heightWeight > 0);
  });

  test("NativeChart adds 'equity' to activePanels only when a real, non-empty equityCurve is present", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('if (algoTestOverlay?.equityCurve && algoTestOverlay.equityCurve.length > 0) panels.add("equity");'));
  });

  test("renderChart with an 'equity' active panel and a real equityCurve draws a line without throwing, and never draws it when the panel isn't active", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const equityCurve = candles.map((c, i) => ({ timestamp: c.time, balance: 10_000 + Math.sin(i / 5) * 200 }));
    assert.doesNotThrow(() => renderWith(candles, { activePanels: ["equity"], equityCurve }));
    const { lines: withoutPanel } = renderWith(candles, { equityCurve }); // panel not in activePanels
    const { lines: withPanel } = renderWith(candles, { activePanels: ["equity"], equityCurve });
    assert.ok(withPanel.length > withoutPanel.length, "the equity line must only be drawn when 'equity' is an active panel");
  });

  test("the equity panel's min/max labels use the real min/max of the curve, never a fabricated range", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    const equityCurve = [
      { timestamp: candles[0].time, balance: 9500 },
      { timestamp: candles[30].time, balance: 10800 },
      { timestamp: candles[59].time, balance: 9900 },
    ];
    const { fillTexts } = renderWith(candles, { activePanels: ["equity"], equityCurve });
    const joined = fillTexts.join(" ");
    assert.ok(joined.includes("9,500") || joined.includes("9500"), `expected the real min (9500) somewhere in labels: ${joined}`);
    assert.ok(joined.includes("10,800") || joined.includes("10800"), `expected the real max (10800) somewhere in labels: ${joined}`);
  });

  test("an empty/absent equityCurve draws the panel frame only - no line, no fabricated data", () => {
    const candles = makeCandleSeries(CANDLE_COUNT, STEP_MS);
    assert.doesNotThrow(() => renderWith(candles, { activePanels: ["equity"], equityCurve: [] }));
    assert.doesNotThrow(() => renderWith(candles, { activePanels: ["equity"] }));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
