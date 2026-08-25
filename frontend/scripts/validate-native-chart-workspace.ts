// scripts/validate-native-chart-workspace.ts
// Sprint D2.7.5 - AT24 Native Chart: Professional Trader Workspace UX.
// Standalone, assert-based verification (no test framework), matching every
// prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:native-chart-workspace`.
//
// This sprint is a UX + interaction sprint, not a new data/feature sprint:
// every test here proves the new professional-workspace surface (chart
// header, grouped indicator menu, fullscreen, session-level state
// persistence, chart controls, honest empty-panel states) is wired
// correctly and that D2.7.2-D2.7.4's already-verified data pipeline,
// switching behavior, and security posture are unaffected - deterministic
// fixtures only, no live credentials, no network calls, no fabricated
// "it works" claims.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { SIGNAL_TIMEFRAMES } from "../types/signal";
import { normalizeCandles } from "../lib/chart-engine/candle-normalizer";
import { fitToData } from "../lib/chart-engine/viewport";
import { nearestCandleIndex } from "../lib/chart-engine/crosshair";
import { nearestIndexByTime } from "../lib/chart-engine/candle-index";
import { computeIndicatorSeries } from "../lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS, INDICATOR_PANEL_ID } from "../lib/chart-engine/indicators/panel-registry";
import { computeRangeChange } from "../lib/chart-engine/range-change";
import { renderChart } from "../lib/chart-engine/renderer";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { TIMEFRAME_LABELS } from "../components/chart-engine/ChartTimeframeSelector";
import type { ChartCandle } from "../types/chart-data";

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
// Fixtures (same deterministic shape as D2.7.2/D2.7.3/D2.7.4's own test files)
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
// 1 - Chart header
// ============================================================
async function chartHeaderTests(): Promise<void> {
  await test("computeRangeChange returns undefined for a series with fewer than 2 candles - never a fabricated change from a single point", () => {
    assert.equal(computeRangeChange([]), undefined);
    assert.equal(computeRangeChange(makeCandleSeries(1, 60_000)), undefined);
  });

  await test("computeRangeChange derives a real change from the first candle's open to the last candle's close", () => {
    const candles = [chartCandle(0, 100, 101, 99, 100), chartCandle(60_000, 100, 106, 99, 105)];
    const change = computeRangeChange(candles);
    assert.ok(change);
    assert.equal(change!.changeAbs, 5);
    assert.equal(change!.changePercent, 5);
    assert.equal(change!.direction, "up");
  });

  await test("computeRangeChange reports 'down'/'neutral' honestly, never guessing a direction on a flat range", () => {
    const down = computeRangeChange([chartCandle(0, 100, 100, 90, 100), chartCandle(60_000, 100, 100, 90, 95)]);
    assert.equal(down!.direction, "down");
    const flat = computeRangeChange([chartCandle(0, 100, 100, 90, 100), chartCandle(60_000, 100, 100, 90, 100)]);
    assert.equal(flat!.direction, "neutral");
    assert.equal(flat!.changeAbs, 0);
  });

  await test("computeRangeChange never divides by a zero reference price (would be a meaningless/Infinity result)", () => {
    assert.equal(computeRangeChange([chartCandle(0, 0, 1, -1, 0), chartCandle(60_000, 0, 1, -1, 1)]), undefined);
  });

  await test("ChartHeader consumes props only - it performs no fetch of its own (Phase 2's 'no duplicated market-data fetching' rule)", () => {
    const src = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(!/fetch\(/.test(src));
    assert.ok(!src.includes("useEffect"));
  });

  await test("ChartHeader renders an honest placeholder, never a fabricated price, when no series/candle is available yet", () => {
    const src = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(src.includes('"—"'));
  });

  await test("ChartHeader's range change is explicitly labeled '(range)' - never presented as a session/daily change this data doesn't actually support", () => {
    const src = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(src.includes("(range)"));
  });

  await test("ChartHeader reuses the SAME TIMEFRAME_LABELS map as ChartTimeframeSelector - never a second, hand-duplicated label map", () => {
    const headerSrc = read("components/chart-engine/ChartHeader.tsx");
    const selectorSrc = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(headerSrc.includes('from "./ChartTimeframeSelector"'));
    assert.ok(selectorSrc.includes("export const TIMEFRAME_LABELS"));
  });

  await test("ChartHeader surfaces real provenance fields (provider/fallbackUsed/cached/freshness) straight from ChartSeries, never invented text", () => {
    const src = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(src.includes("series?.provider") || src.includes("series.provider"));
    assert.ok(src.includes("series?.freshness") || src.includes("series.freshness"));
  });

  await test("ChartHeader is wired into NativeChart above the toolbar, sourced from data NativeChart already has (result.series, timeframe, resolution)", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("<ChartHeader"));
    assert.ok(/series=\{result\.series\}/.test(src));
  });
}

// ============================================================
// 2 - Timeframe selector
// ============================================================
async function timeframeSelectorTests(): Promise<void> {
  await test("every SignalTimeframe has a real display label - no timeframe silently renders blank", () => {
    for (const tf of SIGNAL_TIMEFRAMES) {
      const label = TIMEFRAME_LABELS[tf];
      assert.ok(typeof label === "string" && label.length > 0);
    }
  });

  await test("ChartTimeframeSelector still reuses the EXISTING SignalTimeframe union - no second timeframe registry introduced this sprint", () => {
    const src = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(src.includes('from "@/types/signal"'));
    assert.ok(!/type\s+ChartTimeframe\s*=/.test(src));
  });

  await test("the timeframe control is a real, individually focusable <button> per timeframe - keyboard-accessible via native Tab/Enter without any extra scripting", () => {
    const src = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(src.includes("<button"));
    assert.ok(!src.includes("onClick") || src.includes("onClick={() => onChange(tf)}"));
  });

  await test("the timeframe control exposes its active state via a real ARIA attribute (aria-pressed), not color alone", () => {
    const src = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(src.includes("aria-pressed={value === tf}"));
  });

  await test("the timeframe control group has an accessible group label (role=group + aria-label)", () => {
    const src = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(src.includes('role="group"'));
    assert.ok(src.includes("aria-label="));
  });
}

// ============================================================
// 3 - Indicator management
// ============================================================
async function indicatorManagementTests(): Promise<void> {
  await test("INDICATOR_PANEL_ID (the toolbar's static grouping lookup) agrees EXACTLY with compute.ts's real per-id panel assignment for every default indicator - never allowed to silently drift", () => {
    const candles = makeCandleSeries(60, 60_000);
    for (const cfg of DEFAULT_INDICATOR_CONFIGS) {
      const series = computeIndicatorSeries(candles, cfg);
      assert.equal(INDICATOR_PANEL_ID[cfg.id], series.panel, `mismatch for indicator id "${cfg.id}"`);
    }
  });

  await test("every DEFAULT_INDICATOR_CONFIGS key is unique - the toolbar can never render two indistinguishable checkboxes", () => {
    const keys = DEFAULT_INDICATOR_CONFIGS.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  await test("the toolbar's Indicators menu groups entries into 'Overlays' and 'Panels' - a real, previously-missing distinction (Phase 4)", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes('"Overlays"'));
    assert.ok(src.includes('"Panels"'));
    assert.ok(src.includes("OVERLAY_CONFIGS"));
    assert.ok(src.includes("PANEL_CONFIGS"));
  });

  await test("both indicator groups are still derived from the real DEFAULT_INDICATOR_CONFIGS registry via .filter - never a hardcoded duplicate list", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok((src.match(/DEFAULT_INDICATOR_CONFIGS\.filter/g) ?? []).length >= 2);
  });

  await test("OVERLAY_CONFIGS + PANEL_CONFIGS together cover every default indicator exactly once - the grouping partition is complete and non-overlapping", () => {
    const overlay = DEFAULT_INDICATOR_CONFIGS.filter((cfg) => INDICATOR_PANEL_ID[cfg.id] === "price");
    const panel = DEFAULT_INDICATOR_CONFIGS.filter((cfg) => INDICATOR_PANEL_ID[cfg.id] !== "price");
    assert.equal(overlay.length + panel.length, DEFAULT_INDICATOR_CONFIGS.length);
    const overlapKeys = new Set(overlay.map((c) => c.key));
    for (const cfg of panel) assert.ok(!overlapKeys.has(cfg.key));
  });

  await test("indicator toggle state (activeIndicatorKeys) is still owned by ChartPanel, not NativeChart - the D2.7.4 fix this sprint must not regress. Sprint D2.7.11 Phase 3 - activeIndicatorKeys now lives per-pane inside ChartPanel's own panes array (ChartPaneState), never inside NativeChart itself.", () => {
    const panelSrc = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(panelSrc.includes("useState<ChartPaneState[]>"));
    const paneSrc = read("components/chart-engine/ChartPane.tsx");
    assert.ok(paneSrc.includes("activeIndicatorKeys: Set<string>"));
    const nativeSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(!/const \[activeIndicatorKeys, setActiveIndicatorKeys\] = useState/.test(nativeSrc));
  });

  await test("toggling an unknown indicator key is a no-op - ChartPanel's toggleIndicator only accepts keys the real registry recognizes", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("DEFAULT_INDICATOR_CONFIGS.some((cfg) => cfg.key === key)"));
    assert.ok(src.includes("if (!isKnown) return"));
  });

  await test("the Indicators menu checkbox 'checked' state reads directly from activeIndicatorKeys.has(key) - never a separately tracked, potentially-stale copy", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes("checked={activeIndicatorKeys.has(cfg.key)}"));
  });

  await test("no indicator's underlying math changed this sprint - lib/market-data/indicators.ts is untouched", () => {
    const src = read("lib/market-data/indicators.ts");
    assert.ok(!src.includes("Sprint D2.7.5"));
  });

  await test("compute.ts (the Calculation Layer -> Indicator Data boundary) is untouched by this sprint's UX work", () => {
    const src = read("lib/chart-engine/indicators/compute.ts");
    assert.ok(!src.includes("Sprint D2.7.5"));
  });
}

// ============================================================
// 4 - Chart controls
// ============================================================
async function chartControlsTests(): Promise<void> {
  const toolbarSrc = read("components/chart-engine/ChartToolbar.tsx");

  await test("Fit, Go-to-latest, Indicators, and Fullscreen controls are all present in the toolbar", () => {
    assert.ok(toolbarSrc.includes("Fit the chart to the loaded candle range"));
    assert.ok(toolbarSrc.includes("Go to latest"));
    assert.ok(toolbarSrc.includes("Indicators"));
    assert.ok(toolbarSrc.includes("onToggleFullscreen"));
  });

  await test("controls are grouped logically - symbol/timeframe in one cluster, indicators/view controls in another (two distinct flex groups, not one flat row)", () => {
    assert.ok((toolbarSrc.match(/flex flex-wrap items-center gap-2/g) ?? []).length >= 2);
  });

  await test("every icon-affecting/ambiguous control carries a real tooltip or title, not just a bare glyph", () => {
    assert.ok(toolbarSrc.includes("title="));
    assert.ok(toolbarSrc.includes("<Tooltip"));
  });

  await test("the Fullscreen control reuses the EXISTING Tooltip component - no second tooltip implementation introduced", () => {
    assert.ok(toolbarSrc.includes('from "@/components/ui/Tooltip"'));
  });

  await test("the Indicators dropdown closes on Escape and on an outside click - a real, previously-missing dismissal path", () => {
    assert.ok(toolbarSrc.includes('e.key === "Escape"'));
    assert.ok(toolbarSrc.includes("pointerdown"));
  });

  await test("dismissal listeners are only attached while the menu is actually open, and are cleaned up - no listener leak", () => {
    const effectBlock = toolbarSrc.slice(toolbarSrc.indexOf("useEffect(() => {\n    if (!menuOpen) return;"), toolbarSrc.indexOf("}, [menuOpen]);") + 20);
    assert.ok(effectBlock.includes("removeEventListener"));
  });

  await test("Fit/Go-Live/Fullscreen are real <button type=\"button\"> elements - keyboard-activatable via Enter/Space without extra scripting", () => {
    assert.ok((toolbarSrc.match(/type="button"/g) ?? []).length >= 4);
  });

  await test("no independent 'Reset View' control was invented distinct from Fit - this single-viewport architecture has no separate saved view to reset to, so a second identical control would be UI noise, not a real feature", () => {
    assert.ok(!/Reset View/.test(toolbarSrc));
  });
}

// ============================================================
// 5 - Latest-price marker (D2.7.4 feature, re-verified unaffected)
// ============================================================
async function latestPriceMarkerTests(): Promise<void> {
  await test("the latest-price marker still draws from the real last candle's close - unaffected by this sprint's UX changes", () => {
    const src = read("lib/chart-engine/renderer.ts");
    assert.ok(src.includes("function drawLatestPriceMarker"));
    assert.ok(src.includes("latest.close"));
  });

  await test("the marker still renders without throwing across the full render pipeline, including the new empty-volume-panel notice path", () => {
    const candles = makeCandleSeries(40, 60_000, 100, false); // no volume - exercises the new honest-state path too
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

  await test("renderChart still completes for a zero-candle series (loading/empty placeholder) without throwing", () => {
    const viewport = fitToData([]);
    assert.doesNotThrow(() => {
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 900, height: 500, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles: [],
        viewport,
        timeframe: "1h",
        crosshair: null,
        colors: resolveChartColors(),
      });
    });
  });
}

// ============================================================
// 6 - Crosshair (unaffected by this sprint, re-verified)
// ============================================================
async function crosshairTests(): Promise<void> {
  const candles = makeCandleSeries(200, 60_000);
  const viewport = fitToData(candles);
  const plotWidth = 900;

  await test("crosshair snapping is unaffected - still binary-search equivalent to nearestIndexByTime", () => {
    const targetTime = candles[50].time + 200;
    const x = ((targetTime - viewport.minTime) / (viewport.maxTime - viewport.minTime)) * plotWidth;
    assert.equal(nearestCandleIndex(candles, viewport, x, plotWidth), nearestIndexByTime(candles, targetTime));
  });

  await test("crosshair readout reads already-computed indicator values via valueAtIndex - never recomputes a series on a pointer move (source check)", () => {
    // Sprint D2.7.7 renamed handleMouseMove -> handlePointerMove (native
    // Pointer Events migration) - same invariant, updated reference.
    const src = read("components/chart-engine/NativeChart.tsx");
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!moveHandler.includes("computeIndicatorSeries"));
  });

  await test("the crosshair readout row still uses D2.7.1's financial typography classes, not ad hoc styling", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("FIN_PRIMARY") && src.includes("FIN_SECONDARY"));
  });

  await test("crosshair readout OHLC values use formatPrice (the shared financial formatter), never a raw toFixed/toString call", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const readoutBlock = src.slice(src.indexOf("hoveredCandle ? ("), src.indexOf("Native chart (beta)"));
    assert.ok(!/\.toFixed\(/.test(readoutBlock));
  });
}

// ============================================================
// 7 - Chart state persistence
// ============================================================
// Sprint D2.7.11 (post-completion, roadmap item 2) - promoted from
// sessionStorage (tab-scoped) to a durable per-user DB table
// (ChartWorkspaceLayout), the exact Phase 1 -> 1b precedent this same
// suite already accepted for drawn objects. The sanitization-logic
// tests that used to live here (round-trip, invalid provider/layout
// dropped, invalid pane timeframe dropped, unknown indicator keys
// filtered, missing-symbol pane dropped, corrupted-input handling)
// moved to validate-chart-workspace-layout-persistence.ts, which now
// exercises the SAME exported sanitizers (chart-session-state.ts) via
// the real service against a real Postgres row - a MORE faithful test
// of actual behavior than a fake sessionStorage stand-in ever was, not
// a lesser replacement. What remains here is the wiring: does
// ChartPanel actually call the new durable store, in the same safe
// "effect after mount, guarded against persisting back over a
// not-yet-restored value" shape sessionStorage-era Phase 8 established.
async function statePersistenceTests(): Promise<void> {
  await test("ChartPanel restores saved state via an effect AFTER mount, never a useState initializer - avoids an SSR/client hydration mismatch. Now reads from the durable store (readChartWorkspaceLayout), not sessionStorage.", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(!/useState<ChartProviderKind>\(\(\) => readChartWorkspaceLayout/.test(src));
    assert.ok(src.includes("readChartWorkspaceLayout("));
    assert.ok(src.includes("useEffect(() => {"));
  });

  await test("ChartPanel does not persist BACK over a not-yet-restored saved value - a hydratedRef guard exists, now guarding an ASYNC restore (the durable fetch takes real network time, unlike the old synchronous sessionStorage read - this guard matters even more now)", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("hydratedRef"));
    assert.ok(src.includes("if (!hydratedRef.current) return"));
  });

  await test("ChartPanel persists via writeChartWorkspaceLayout (the durable store), never the retired sessionStorage writer", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("writeChartWorkspaceLayout("));
    assert.ok(!src.includes("writeChartSessionState("), "the old sessionStorage writer must be genuinely gone, not left as dead/unused code alongside the new one");
  });

  await test("chart-session-state.ts's own sessionStorage I/O (readChartSessionState/writeChartSessionState/CHART_SESSION_STORAGE_KEY) is genuinely retired, not left as dead code - only the shared TYPES and SANITIZERS survive the promotion to a durable store, since chart-workspace-layout.service.ts now imports those same sanitizers directly", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/export function readChartSessionState|export function writeChartSessionState|CHART_SESSION_STORAGE_KEY/.test(src));
    assert.ok(src.includes("export function sanitizePane"));
    assert.ok(src.includes("export function isChartProviderKind"));
    assert.ok(src.includes("export function isChartLayout"));
  });

  await test("the durable ChartWorkspaceLayout table is real per-user and auth-gated - userId always comes from the authenticated session, never trusted from the request body, the same security posture every other durable per-user table (ChartDrawingSet/ChartTemplate) already follows", () => {
    const routeSrc = read("app/api/private/chart-workspace-layout/route.ts");
    assert.ok(routeSrc.includes("getUserOrNull()"));
    assert.ok(routeSrc.includes("sessionUser.profile.id"));
    assert.ok(!/password|token|email/i.test(read("services/chart/chart-workspace-layout.service.ts")), "no PII/credential fields in the persisted state");
  });

  await test("fullscreen state is deliberately NOT persisted across a reload - a jarring auto-fullscreen on page load would be worse UX, not better", () => {
    const sessionSrc = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/fullscreen/i.test(sessionSrc));
  });

  await test("viewport (pan/zoom position) is deliberately NOT persisted - a stale saved time range is unsafe to reapply, especially for intraday timeframes; the chart continues to always re-fit on load", () => {
    const sessionSrc = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/viewport|minTime|maxTime/i.test(sessionSrc));
  });

  await test("the durable, cross-device WorkspacePreferences persistence layer (symbol/profile/favorites) is untouched by this sprint - session state is a genuinely separate, smaller-scoped mechanism", () => {
    const src = read("context/WorkspaceContext.tsx");
    assert.ok(!src.includes("Sprint D2.7.5"));
  });
}

// ============================================================
// 8 - Fullscreen / focus mode
// ============================================================
async function fullscreenTests(): Promise<void> {
  const nativeSrc = read("components/chart-engine/NativeChart.tsx");

  await test("NativeChart owns a real isFullscreen boolean state and a toggle handler", () => {
    assert.ok(nativeSrc.includes("const [isFullscreen, setIsFullscreen] = useState(false)"));
    assert.ok(nativeSrc.includes("function handleToggleFullscreen()"));
  });

  await test("Escape exits fullscreen via a window-level keydown listener, scoped only to while fullscreen is active", () => {
    const effectBlock = nativeSrc.slice(nativeSrc.indexOf("if (!isFullscreen) return;\n    function handleEscape"), nativeSrc.indexOf("}, [isFullscreen]);") + 20);
    assert.ok(effectBlock.includes('e.key === "Escape"'));
    assert.ok(effectBlock.includes("setIsFullscreen(false)"));
    assert.ok(effectBlock.includes("removeEventListener"));
  });

  await test("the fullscreen wrapper uses a fixed full-viewport overlay, matching this codebase's existing z-50 topmost-overlay convention (Modal.tsx/MobileNav.tsx) - not a new z-index scale", () => {
    assert.ok(nativeSrc.includes("fixed inset-0 z-50"));
    const modalSrc = read("components/ui/Modal.tsx");
    assert.ok(modalSrc.includes("z-50"));
  });

  await test("the canvas container height becomes flexible (fills available space) in fullscreen, instead of the fixed BASE_PANEL_HEIGHT used otherwise", () => {
    assert.ok(nativeSrc.includes('isFullscreen ? "relative w-full min-h-0 flex-1" : "relative w-full"'));
  });

  await test("the SAME ResizeObserver effect (no new resize/DPR logic) picks up the fullscreen layout change - it observes the container's real box regardless of how CSS sizes it", () => {
    const resizeEffect = nativeSrc.slice(nativeSrc.indexOf("new ResizeObserver"), nativeSrc.indexOf("new ResizeObserver") + 800);
    assert.ok(resizeEffect.includes("observer.disconnect()"));
    // no second/duplicate ResizeObserver was introduced for fullscreen specifically
    assert.equal((nativeSrc.match(/new ResizeObserver/g) ?? []).length, 1);
  });

  await test("the toolbar's fullscreen button reflects state via aria-pressed and a real accessible label, not an icon alone", () => {
    const toolbarSrc = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(toolbarSrc.includes("aria-pressed={isFullscreen}"));
    assert.ok(toolbarSrc.includes("aria-label={isFullscreen"));
  });

  await test("fullscreen is scoped to the native chart only - AdvancedChart.tsx (TradingView) is untouched by this sprint's fullscreen work", () => {
    const advancedSrc = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(!advancedSrc.includes("Sprint D2.7.5"));
    assert.ok(!/isFullscreen/.test(advancedSrc));
  });

  await test("entering/exiting fullscreen does not remount the canvas (no `key` prop churn) - the existing canvas ref/viewport state survives the transition", () => {
    const returnBlock = nativeSrc.slice(nativeSrc.indexOf("return (\n    <div className={isFullscreen"));
    const canvasBlock = returnBlock.slice(returnBlock.indexOf("<canvas"), returnBlock.indexOf("/>", returnBlock.indexOf("<canvas")));
    assert.ok(!canvasBlock.includes("key="));
  });
}

// ============================================================
// 9 - Responsive behavior
// ============================================================
async function responsiveTests(): Promise<void> {
  await test("ChartHeader wraps on narrow viewports (flex-wrap), never forcing horizontal overflow", () => {
    const src = read("components/chart-engine/ChartHeader.tsx");
    assert.ok(src.includes("flex-wrap"));
  });

  await test("ChartToolbar wraps on narrow viewports - both control clusters use flex-wrap", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok((src.match(/flex-wrap/g) ?? []).length >= 2);
  });

  await test("the Indicators dropdown panel has a bounded width (not a viewport-relative or unbounded size) so it can't itself cause horizontal overflow on mobile", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(/w-56/.test(src));
  });

  await test("no new fixed pixel width wider than the existing dropdown/menu convention was introduced in this sprint's new components", () => {
    for (const f of ["components/chart-engine/ChartHeader.tsx", "components/chart-engine/ChartToolbar.tsx"]) {
      const widths = [...read(f).matchAll(/\bw-\[(\d+)px\]/g)].map((m) => Number(m[1]));
      for (const w of widths) assert.ok(w <= 400, `unexpectedly wide fixed element (${w}px) in ${f}`);
    }
  });

  await test("the crosshair OHLC/indicator readout row wraps (flex-wrap) - unaffected, still responsive", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes('className="flex flex-wrap items-center gap-3 text-xs"'));
  });
}

// ============================================================
// 10 - Loading / error / empty / stale / unsupported states
// ============================================================
async function chartStateTests(): Promise<void> {
  const src = read("components/chart-engine/NativeChart.tsx");

  await test("every honest chart state from D2.7.2/D2.7.3 is still handled: unsupported, loading, error, empty, stale", () => {
    assert.ok(src.includes('result.status === "loading"'));
    assert.ok(src.includes('result.status === "unsupported"'));
    assert.ok(src.includes('result.status === "error"'));
    assert.ok(src.includes('result.status === "empty"'));
    assert.ok(src.includes('result.status === "stale"'));
  });

  await test("an unsupported instrument still renders an honest message, never a fallback chart for a different symbol", () => {
    assert.ok(src.includes("Chart visualization is unavailable for"));
  });

  await test("the rejected-candle-count disclosure (partial/data-integrity honesty) is unaffected by this sprint", () => {
    assert.ok(src.includes("rejectedCount > 0"));
    assert.ok(src.includes("failing data-integrity checks"));
  });

  await test("no chart state branch was removed or renamed by this sprint's header/fullscreen additions", () => {
    const statuses = ["loading", "unsupported", "error", "empty"];
    for (const s of statuses) assert.ok(src.includes(`result.status === "${s}"`));
  });
}

// ============================================================
// 11/12 - Symbol switching + timeframe switching (source-level proof,
// matching D2.7.2-D2.7.4's own no-DOM-test-framework convention for React
// hooks/effects)
// ============================================================
async function switchingTests(): Promise<void> {
  const hookSrc = read("components/chart-engine/useChartCandles.ts");
  const nativeSrc = read("components/chart-engine/NativeChart.tsx");

  await test("a symbol OR timeframe change re-runs the data effect (both are real dependencies) - no stale request can silently apply to the new selection", () => {
    assert.ok(hookSrc.includes("}, [symbol, timeframe, outputSize]);"));
  });

  await test("every symbol/timeframe change gets its own AbortController and cancels the previous request's ability to apply its result", () => {
    assert.ok(hookSrc.includes("const controller = new AbortController();"));
    assert.ok(hookSrc.includes("controller.abort()"));
    assert.ok(hookSrc.includes("if (cancelled) return"));
  });

  await test("the viewport re-fit key is symbol|timeframe together - switching EITHER always produces a fresh fit, never a stale viewport from a different instrument/timeframe", () => {
    assert.ok(nativeSrc.includes("const key = `${symbol}|${timeframe}`;"));
  });

  await test("repeated symbol switches (e.g. NIFTY50 -> BANKNIFTY -> ... -> NIFTY50) always re-derive the resolution/instrument fresh from the current `symbol` - never a cached/stale resolution object", () => {
    assert.ok(nativeSrc.includes("const resolution = resolveChartInstrument(symbol);"));
  });

  await test("indicator selections are NOT cleared by a timeframe change - activeIndicatorKeys is a prop from ChartPanel, entirely independent of the candles-fetch effect's dependency array", () => {
    const effectSrc = nativeSrc.slice(nativeSrc.indexOf("useEffect(() => {\n    const key = "), nativeSrc.indexOf("}, [candles, symbol, timeframe, draw]);") + 40);
    assert.ok(!effectSrc.includes("onToggleIndicator"));
    assert.ok(!/setActiveIndicatorKeys/.test(effectSrc));
  });

  await test("indicator series ARE recomputed on a timeframe change (via the candles dependency, since new candles arrive) - never stale values shown against new candle data", () => {
    assert.ok(nativeSrc.includes("() => activeConfigs.map((cfg) => computeIndicatorSeries(candles, cfg)),\n    [candles, activeConfigs],"));
  });

  await test("candle spacing (candleStepMs) is derived from the real fetched data every time, never a hardcoded per-timeframe constant that could go stale across a timeframe switch", () => {
    const viewportSrc = read("lib/chart-engine/viewport.ts");
    assert.ok(viewportSrc.includes("return candles[1].time - candles[0].time;"));
  });
}

// ============================================================
// 13 - Native / TradingView coexistence (re-verified, plus new
// header/fullscreen/session-state boundary checks)
// ============================================================
async function coexistenceTests(): Promise<void> {
  const panelSrc = read("components/chart-engine/ChartPanel.tsx");
  const advancedSrc = read("components/workspace/tradingview/AdvancedChart.tsx");

  await test("the provider toggle remains explicit (native | tradingview), unchanged by this sprint", () => {
    assert.ok(panelSrc.includes('provider === "native" ? ('));
    assert.ok(!/catch[\s\S]{0,100}AdvancedChart/.test(panelSrc));
  });

  await test("AdvancedChart.tsx (TradingView) remains completely untouched by D2.7.5", () => {
    assert.ok(!advancedSrc.includes("Sprint D2.7.5"));
    assert.ok(advancedSrc.includes("export default function AdvancedChart"));
  });

  await test("the chart provider choice now also persists across a reload (Phase 8) - restored the same way as timeframe/indicators, via ChartPanel's session-state effect", () => {
    assert.ok(panelSrc.includes("saved.provider"));
    assert.ok(panelSrc.includes("setProvider(saved.provider)"));
  });

  await test("switching provider still does not change market-data provider routing - shared-instance.ts untouched by this sprint", () => {
    const src = read("services/market-data/shared-instance.ts");
    assert.ok(!src.includes("Sprint D2.7.5"));
  });

  await test("no second symbol registry was introduced by this sprint's new files", () => {
    for (const f of [
      "components/chart-engine/ChartHeader.tsx",
      "components/chart-engine/ChartToolbar.tsx",
      "lib/chart-engine/chart-session-state.ts",
    ]) {
      assert.ok(!/SYMBOL_MAP|SYMBOL_REGISTRY/.test(read(f)));
    }
  });

  await test("fullscreen mode is scoped to NativeChart's own returned tree - it cannot visually swallow the TradingView chart or vice versa (each chart owns its own wrapper)", () => {
    const nativeSrc = read("components/chart-engine/NativeChart.tsx");
    assert.ok(nativeSrc.includes("isFullscreen ? \"fixed inset-0 z-50"));
    assert.ok(!advancedSrc.includes("fixed inset-0"));
  });
}

// ============================================================
// 14/15/16 - Indian instruments, crypto, FX/metals (catalog + chart
// resolution proof, deterministic, no live provider calls)
// ============================================================
async function instrumentClassTests(): Promise<void> {
  const indian = ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"];
  await test("every Indian instrument still resolves to a real catalog entry mapped exclusively to Angel One", () => {
    for (const id of indian) {
      const instrument = getCanonicalInstrument(id);
      assert.ok(instrument, `${id} missing from catalog`);
      const providers = instrument!.providerMappings.map((m) => m.provider);
      assert.ok(providers.includes("angel-one"));
      assert.ok(!providers.includes("binance"));
    }
  });

  await test("every Indian instrument's chart resolution is a real NSE:-prefixed TradingView symbol, never a guessed/fallback symbol", () => {
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

  await test("crypto instruments are in the catalog with real provider mappings, never fabricated", () => {
    for (const id of crypto) assert.ok(getCanonicalInstrument(id));
  });

  const fxMetals = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"];
  await test("FX/metals instruments all resolve to real, chartable symbols", () => {
    for (const id of fxMetals) {
      const resolution = resolveChartInstrument(id);
      assert.equal(resolution.supported, true, `${id} should be chart-supported`);
      assert.ok(resolution.chartSymbol);
    }
  });

  await test("FX/metals instruments exist in the real catalog with an FX or commodities exchange mapping", () => {
    for (const id of fxMetals) assert.ok(getCanonicalInstrument(id));
  });
}

// ============================================================
// 17 - Security
// ============================================================
async function securityTests(): Promise<void> {
  await test("no API key/secret/token pattern appears in any new D2.7.5 client file", () => {
    for (const f of [
      "components/chart-engine/ChartHeader.tsx",
      "components/chart-engine/ChartToolbar.tsx",
      "components/chart-engine/ChartPanel.tsx",
      "components/chart-engine/NativeChart.tsx",
      "lib/chart-engine/chart-session-state.ts",
      "lib/chart-engine/range-change.ts",
    ]) {
      assert.ok(!/apiKey|API_KEY|_SECRET|_PASSWORD/i.test(read(f)));
    }
  });

  await test("session state storage carries no PII/credential fields - only provider/timeframe/indicatorKeys", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!/password|token|email|userId/i.test(src));
  });

  await test("chart-session-state.ts is now a pure types+sanitizers module - genuinely zero sessionStorage I/O remains (deliberately promoted to a durable per-user table this sprint, see chart-workspace-layout-store.ts/chart-workspace-layout.service.ts - this replaces this test's own former, now-superseded 'never promoted to durable' assertion)", () => {
    const src = read("lib/chart-engine/chart-session-state.ts");
    assert.ok(!src.includes("window.sessionStorage"));
  });

  await test("the candles API route's auth/validation/security posture is unchanged by this sprint - route.ts untouched", () => {
    const src = read("app/api/private/market-data/candles/route.ts");
    assert.ok(!src.includes("Sprint D2.7.5"));
  });

  await test("the durable store's client read never throws on a hostile/corrupted response or offline network - readChartWorkspaceLayout has its own try/catch boundary, same 'never blocks the chart UI' contract the old sessionStorage reader always had", () => {
    const src = read("lib/chart-engine/chart-workspace-layout-store.ts");
    assert.ok((src.match(/try \{/g) ?? []).length >= 2, "both readChartWorkspaceLayout and the write path need their own try/catch");
  });
}

// ============================================================
// 18 - Performance guards
// ============================================================
async function performanceTests(): Promise<void> {
  for (const count of [500, 2000, 5000]) {
    await test(`full pipeline still completes within budget at ${count} candles, including the new empty-volume-panel notice path`, () => {
      const candles = makeCandleSeries(count, 60_000, 100, count === 2000 ? false : true); // exercise the no-volume honest-state branch at one scale
      const t0 = Date.now();
      const { candles: normalized } = normalizeCandles(
        candles.map((c) => ({ datetime: new Date(c.time).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
      );
      const viewport = fitToData(normalized);
      const series = DEFAULT_INDICATOR_CONFIGS.map((cfg) => computeIndicatorSeries(normalized, cfg));
      renderChart({
        ctx: fakeCtx(),
        dims: { width: 1200, height: 700, priceAxisWidth: 64, timeAxisHeight: 22 },
        candles: normalized,
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

  await test("INDICATOR_PANEL_ID is an O(1) static lookup, not a per-render scan - the toolbar's grouping is computed once at module load, not per render", () => {
    const src = read("lib/chart-engine/indicators/panel-registry.ts");
    assert.ok(src.includes("export const INDICATOR_PANEL_ID: Record"));
  });

  await test("OVERLAY_CONFIGS/PANEL_CONFIGS in ChartToolbar are computed once at module scope, not recomputed on every render", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    const beforeComponent = src.slice(0, src.indexOf("export default function ChartToolbar"));
    assert.ok(beforeComponent.includes("const OVERLAY_CONFIGS"));
    assert.ok(beforeComponent.includes("const PANEL_CONFIGS"));
  });

  await test("no React setState is called directly from pan/zoom/crosshair pointer handlers - unaffected by this sprint's additions", () => {
    // Sprint D2.7.7 renamed handleMouseMove -> handlePointerMove (native
    // Pointer Events migration) - same invariant, updated reference.
    const src = read("components/chart-engine/NativeChart.tsx");
    const moveHandler = src.slice(src.indexOf("function handlePointerMove"), src.indexOf("function releasePointer"));
    assert.ok(!moveHandler.includes("setIsLive("));
  });

  await test("the fullscreen Escape listener is attached/removed only on isFullscreen transitions, never on every render", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("}, [isFullscreen]);"));
  });
}

// ============================================================
// 19 - No-fabrication guarantees
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("no hardcoded fallback symbol (EURUSD/BTCUSD) exists in this sprint's new/modified files", () => {
    for (const f of [
      "components/chart-engine/ChartHeader.tsx",
      "components/chart-engine/ChartToolbar.tsx",
      "components/chart-engine/ChartPanel.tsx",
      "components/chart-engine/NativeChart.tsx",
      "lib/chart-engine/chart-session-state.ts",
      "lib/chart-engine/range-change.ts",
    ]) {
      assert.ok(!/EURUSD|BTCUSD/.test(read(f)));
    }
  });

  await test("no BUY/SELL/automated-trading/broker-execution language exists anywhere in this sprint's changes", () => {
    for (const f of [
      "components/chart-engine/ChartHeader.tsx",
      "components/chart-engine/ChartToolbar.tsx",
      "components/chart-engine/ChartPanel.tsx",
      "components/chart-engine/NativeChart.tsx",
      "lib/chart-engine/chart-session-state.ts",
      "lib/chart-engine/range-change.ts",
      "lib/chart-engine/sub-panel-renderer.ts",
    ]) {
      assert.ok(!/\bBUY\b|\bSELL\b|place order|execute trade|broker/i.test(read(f)));
    }
  });

  await test("no Redis/Kafka/WebSocket dependency was introduced by this sprint's new files", () => {
    for (const f of ["lib/chart-engine/chart-session-state.ts", "components/chart-engine/ChartPanel.tsx"]) {
      const src = read(f);
      assert.ok(!/redis|kafka/i.test(src));
      assert.ok(!/new WebSocket\(|socket\.io|wss?:\/\//.test(src));
    }
  });

  await test("the empty-volume-panel notice only ever states a real, verifiable fact (no volume field present) - never a guess about WHY it's missing", () => {
    const src = read("lib/chart-engine/sub-panel-renderer.ts");
    assert.ok(src.includes("No volume data for this instrument"));
    assert.ok(!/provider (is down|failed)/i.test(src));
  });

  await test("Intelligence Score/Regime/Hypothesis/DecisionContext services are untouched by D2.7.5", () => {
    for (const f of [
      "services/intelligence/score/intelligence-score.service.ts",
      "services/intelligence/regime/regime.service.ts",
      "services/intelligence/hypothesis/hypothesis.service.ts",
      "services/intelligence/decision/decision-context.service.ts",
    ]) {
      assert.ok(!read(f).includes("Sprint D2.7.5"));
    }
  });

  await test("no alerts/paper-trading/order-placement language exists anywhere in this sprint's changes", () => {
    for (const f of ["components/chart-engine/ChartHeader.tsx", "components/chart-engine/ChartToolbar.tsx", "components/chart-engine/NativeChart.tsx"]) {
      assert.ok(!/paper trading|place an order|create alert/i.test(read(f)));
    }
  });
}

// ============================================================
// 20 - Accessibility guards
// ============================================================
async function accessibilityTests(): Promise<void> {
  const toolbarSrc = read("components/chart-engine/ChartToolbar.tsx");

  await test("the Indicators menu button has aria-expanded/aria-haspopup, and the menu itself has role=menu + an aria-label", () => {
    assert.ok(toolbarSrc.includes("aria-expanded={menuOpen}"));
    assert.ok(toolbarSrc.includes('aria-haspopup="true"'));
    assert.ok(toolbarSrc.includes('role="menu"'));
    assert.ok(toolbarSrc.includes('aria-label="Chart indicators"'));
  });

  await test("the fullscreen toggle exposes both a visible tooltip (for sighted users) and an aria-label (for screen readers) - not just a bare glyph", () => {
    assert.ok(toolbarSrc.includes("<Tooltip label="));
    assert.ok(toolbarSrc.includes("aria-label={isFullscreen"));
  });

  await test("Escape reliably dismisses the Indicators dropdown - a real keyboard escape hatch, not just an outside click", () => {
    assert.ok(toolbarSrc.includes('e.key === "Escape"'));
  });

  await test("the reused Tooltip component renders a real role=tooltip element - no second, non-semantic tooltip implementation exists in this sprint's changes", () => {
    const tooltipSrc = read("components/ui/Tooltip.tsx");
    assert.ok(tooltipSrc.includes('role="tooltip"'));
  });

  await test("the canvas remains keyboard-focusable (tabIndex=0) with its existing keyboard nav (arrows/+/-/Home/End) unaffected by this sprint", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    assert.ok(src.includes("tabIndex={0}"));
    assert.ok(src.includes('e.key === "ArrowLeft"'));
  });

  await test("the provider toggle and timeframe selector still expose their active state via aria-pressed, unaffected by this sprint", () => {
    const providerSrc = read("components/chart-engine/ChartProviderToggle.tsx");
    const timeframeSrc = read("components/chart-engine/ChartTimeframeSelector.tsx");
    assert.ok(providerSrc.includes("aria-pressed={value === opt.value}"));
    assert.ok(timeframeSrc.includes("aria-pressed={value === tf}"));
  });

  await test("no keyboard trap was introduced - the fullscreen overlay's only new listener (Escape) always exits, never blocks Escape/Tab from propagating further", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const escapeEffect = src.slice(src.indexOf("function handleEscape"), src.indexOf("window.addEventListener(\"keydown\", handleEscape)") + 40);
    assert.ok(!escapeEffect.includes("preventDefault"));
    assert.ok(!escapeEffect.includes("stopPropagation"));
  });

  await test("indicator checkboxes are real <input type=\"checkbox\"> wrapped in a <label> - natively keyboard/screen-reader accessible, no ARIA reinvention needed", () => {
    assert.ok(toolbarSrc.includes('<label\n'));
    assert.ok(toolbarSrc.includes('type="checkbox"'));
  });
}

async function main(): Promise<void> {
  await chartHeaderTests();
  await timeframeSelectorTests();
  await indicatorManagementTests();
  await chartControlsTests();
  await latestPriceMarkerTests();
  await crosshairTests();
  await statePersistenceTests();
  await fullscreenTests();
  await responsiveTests();
  await chartStateTests();
  await switchingTests();
  await coexistenceTests();
  await instrumentClassTests();
  await securityTests();
  await performanceTests();
  await noFabricationTests();
  await accessibilityTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
