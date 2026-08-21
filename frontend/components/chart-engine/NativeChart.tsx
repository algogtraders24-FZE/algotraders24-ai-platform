"use client";

// components/chart-engine/NativeChart.tsx
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation, Phases 11-16. The
// React/Canvas orchestrator: owns the canvas ref, viewport/crosshair
// interaction state, ResizeObserver-driven sizing, and honest loading/
// empty/stale/error/unsupported states. All drawing math (coordinate
// conversion, tick generation, candle classification) lives in
// lib/chart-engine/* - this component only wires DOM events to that pure
// core and calls renderChart(). Never fetches from a provider directly,
// never a second symbol/timeframe registry: reads the active symbol from
// WorkspaceContext and consumes /api/private/market-data/candles via
// useChartCandles.
//
// Performance (Phase 14, D2.7.2 / Phase 12, D2.7.3): pan/zoom/crosshair
// interaction updates a `viewportRef`/`crosshairRef` and calls `draw()`
// directly - it does NOT go through React state on every mousemove, so a
// drag or zoom gesture never triggers a React re-render per frame. React
// state is used only for the rarer events (data load, resize, timeframe
// change, indicator toggle) and for the DOM-rendered OHLC/indicator
// readout (throttled to one state update per animation frame), which
// needs D2.7.1's FIN_* typography classes - something canvas text cannot
// apply. IndicatorSeries are computed via useMemo keyed on
// [candles, activeConfigs] - never recomputed on a pan/zoom/crosshair
// frame, only when the underlying data or the active indicator set
// actually changes.
//
// Sprint D2.7.3 - Production Data Layer, Indicators & Professional Chart
// UX. Adds: cursor-centered zoom (already true since D2.7.2, kept),
// keyboard navigation, live-edge "follow latest" behavior (viewport.ts's
// isAtRightEdge/followLatest), the indicator overlay/sub-panel system
// (lib/chart-engine/indicators/*, sub-panel-renderer.ts, panel-layout.ts),
// and a crosshair readout that includes volume + every active indicator's
// real value at the hovered candle - never interpolated.
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatPrice, formatTimestamp, formatCompactVolume, formatDuration } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY, financialDirectionClass } from "@/components/ui/financial-typography";
import { resolveChartInstrument } from "@/lib/market-data/chart-instrument-resolver";
import { resolveChartColors, CHART_THEME_LABELS, type ChartTheme } from "@/lib/chart-engine/canvas-colors";
import { nearestCandleIndex } from "@/lib/chart-engine/crosshair";
import { renderChart } from "@/lib/chart-engine/renderer";
import {
  candleStepMs,
  clampViewportToCandleBounds,
  fitToData,
  followLatest,
  isAtRightEdge,
  panViewport,
  priceRangeForWindow,
  zoomViewport,
} from "@/lib/chart-engine/viewport";
import { classifyCandle } from "@/lib/chart-engine/candle-classifier";
import { computeIndicatorSeries, valueAtIndex } from "@/lib/chart-engine/indicators/compute";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { computePanelLayout } from "@/lib/chart-engine/panel-layout";
import { indexRangeForViewport, xToIndex, fractionalIndexToTime } from "@/lib/chart-engine/index-scale";
import type { ChartCandle, ChartSeries } from "@/types/chart-data";
import type { ChartRenderType, CrosshairState, Viewport } from "@/lib/chart-engine/types";
import type { SignalTimeframe } from "@/types/signal";
import type { ChartPanelId, IndicatorSeries } from "@/lib/chart-engine/indicators/types";
import { useChartCandles } from "./useChartCandles";
import { useLiveQuote } from "./useLiveQuote";
import ChartToolbar from "./ChartToolbar";
import ChartHeader from "./ChartHeader";
import MicrostructurePanel from "./MicrostructurePanel";
// MT5 feature-parity Phase 1 - Drawing Tools (trend line, horizontal
// line, rectangle). See docs/architecture/D2.7.11-native-chart-mt5-
// feature-parity-roadmap.md for the full phased plan this belongs to.
import DrawingToolbar from "./DrawingToolbar";
import { hitTestObjects, pixelToPoint, applyDrag } from "@/lib/chart-engine/drawing/geometry";
import { readDrawingObjects, writeDrawingObjects } from "@/lib/chart-engine/drawing/store";
import {
  createHorizontalLine,
  createTrendLine,
  createRectangle,
  createFibonacci,
  type DrawingObject,
  type DrawingHandle,
  type DrawingPoint,
  type DrawingPreview,
  type DrawingToolId,
} from "@/lib/chart-engine/drawing/types";
// Sprint D2.7.11 Phase 4 - saved chart templates (MT5's own real Template
// feature). See docs/architecture/D2.7.11-native-chart-mt5-feature-parity-
// roadmap.md for the full phased plan this belongs to.
import { listTemplates, saveTemplate, deleteTemplate } from "@/lib/chart-engine/templates/store";
import type { ChartTemplate } from "@/lib/chart-engine/templates/types";
import Modal from "@/components/ui/Modal";

const PRICE_AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 22;
const ZOOM_IN_FACTOR = 0.9;
const ZOOM_OUT_FACTOR = 1.1;
const BASE_PANEL_HEIGHT = 380;
const SUB_PANEL_HEIGHT = 110;
const PAN_KEY_STEP_CANDLES = 5;
// Sprint D2.7.11 Phase 5c - the Properties dialog's Colors-tab scheme
// picker only offers the two real, screenshot-grounded MT5 schemes
// (canvas-colors.ts) - deliberately never "at24" here, since that's the
// platform's own generic token-driven theme, not an MT5 scheme choice.
const COLOR_SCHEMES: ChartTheme[] = ["mt5", "mt5-green"];

export interface NativeChartProps {
  /**
   * Sprint D2.7.11 Phase 3 - multi-symbol tiled layout. `symbol`/`name` are
   * now controlled props (one pane's own instrument), never read from
   * WorkspaceContext directly - a page can have several NativeChart
   * instances mounted at once (one per visible grid pane), each showing a
   * genuinely different symbol, which a single shared context value could
   * never represent. ChartPanel/ChartPane own this the exact same way they
   * already own `timeframe`/`activeIndicatorKeys` below (see that comment) -
   * one more field lifted to the same existing owner, not a new pattern.
   * WorkspaceContext's OWN `symbol` still exists and still drives every
   * OTHER workspace panel (header, AI intelligence, assistant, research,
   * ribbon) - it's simply no longer the ONLY symbol on the page. Exactly
   * one pane (the "primary" one, see ChartPanel.tsx) is kept in sync with
   * it bidirectionally; every other pane's symbol is independent.
   */
  symbol: string;
  name?: string;
  /**
   * Sprint D2.7.4 - timeframe/indicator selection is now OWNED by ChartPanel
   * (controlled props here), not local state. Fixes a real Phase 11 bug:
   * NativeChart previously held this in its own useState, which React
   * destroys whenever ChartPanel's native/tradingview ternary unmounts it -
   * so switching to TradingView and back silently reset the timeframe to
   * "1h" and cleared every active indicator, violating "switching provider
   * must preserve timeframe". Lifting the state to the parent (which never
   * unmounts on a provider toggle) fixes this with zero new registry/state
   * duplication - ChartPanel is the one existing place both chart
   * providers are already composed.
   */
  timeframe: SignalTimeframe;
  onTimeframeChange: (timeframe: SignalTimeframe) => void;
  activeIndicatorKeys: ReadonlySet<string>;
  onToggleIndicator: (key: string) => void;
  /** Sprint D2.7.11 Phase 4 - replaces the WHOLE active indicator set at once (applying a saved template), never a series of individual toggles. */
  onApplyIndicatorKeys: (keys: readonly string[]) => void;
}

export default function NativeChart({ symbol, name, timeframe, onTimeframeChange, activeIndicatorKeys, onToggleIndicator, onApplyIndicatorKeys }: NativeChartProps) {
  // Sprint D2.8.13 - `hypothesisType` is the real, already-fetched active
  // hypothesis WorkspaceResearch found for this same symbol (D2.8.13's own
  // WorkspaceContext addition) - reused here verbatim, never a second
  // fetch/computation, so MicrostructurePanel can render D2.8.11/D2.8.12's
  // real evidence relationship instead of only raw numbers.
  //
  // Sprint D2.7.11 Phase 3 - `activeSymbol` (WorkspaceContext's own symbol,
  // distinct from this component's own `symbol` PROP above) is read only
  // to guard this: WorkspaceResearch fetched `hypothesisType` for whichever
  // symbol is the page's primary one, not necessarily THIS pane's symbol
  // once multiple panes can show different instruments. Forwarding it to a
  // pane showing a DIFFERENT symbol than the one it was actually computed
  // for would misattribute another instrument's hypothesis - the guard
  // below keeps this exactly as honest as it was when only one chart could
  // ever exist (implicitly always true then; explicit now that it isn't).
  const { symbol: activeSymbol, hypothesisType } = useWorkspace();
  const [isLive, setIsLive] = useState(true);
  // Sprint D2.7.11 Phase 5 - MT5's Bar/Candlesticks/Line chart-type toggle.
  // Local, like isLive/activeTool above (not lifted to ChartPanel): this is
  // a pure rendering-style preference, not per-instrument data, and this
  // NativeChart instance already stays mounted for the pane's whole
  // lifetime (D2.7.11 Phase 3) - only the TradingView<->Native provider
  // toggle unmounts it, at which point isLive/activeTool already reset too.
  const [chartType, setChartType] = useState<ChartRenderType>("candlestick");
  // Sprint D2.7.11 Phase 5b - MT5's Properties dialog "Show" tab (Grid /
  // Period separators). Also local, same reasoning as chartType above.
  // showGrid defaults to true (this renderer has always drawn the grid
  // unconditionally, so this preserves that exact behavior); showPeriodSeparators
  // defaults to false, matching real MT5's own default.
  const [showGrid, setShowGrid] = useState(true);
  const [showPeriodSeparators, setShowPeriodSeparators] = useState(false);
  // Sprint D2.7.11 Phase 5c - MT5's Properties dialog Colors-tab scheme
  // picker. Defaults to "mt5" - the exact theme this chart already always
  // rendered before this phase (resolveChartColors("mt5") was previously
  // hardcoded below), so this is zero visual change until a user actually
  // opens Properties and picks something else.
  const [colorScheme, setColorScheme] = useState<ChartTheme>("mt5");
  const [propertiesModalOpen, setPropertiesModalOpen] = useState(false);
  // Sprint D2.7.5, Phase 9 - a CSS-driven focus mode (not the browser
  // Fullscreen API): toggling this class alone naturally re-triggers the
  // EXISTING ResizeObserver effect below (it observes containerRef's real
  // box, whatever CSS makes that box be), so devicePixelRatio-correct
  // resizing and redraw already work for free - no new resize/DPR logic
  // needed. The browser Fullscreen API was deliberately avoided: it
  // requires a transient user gesture in some browsers, can be blocked
  // inside an embedded/iframed preview, and buys nothing here that a fixed
  // full-viewport overlay doesn't already provide just as reliably.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const resolution = resolveChartInstrument(symbol);
  const result = useChartCandles(symbol, timeframe);
  // This session - the price panel's current-price marker prefers this
  // live bid/ask over the last candle's close (see useLiveQuote.ts's own
  // header comment). Independent of the candles fetch/poll above - a slow
  // or failed quote poll never blocks or degrades candle rendering.
  const liveQuote = useLiveQuote(symbol);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Sprint D2.7.11 - React attaches its delegated `wheel` listener as
  // PASSIVE by default (a React 17+ perf change - wheel/touchstart/
  // touchmove are known scroll-related events browsers warn about for
  // non-passive listeners). A passive listener silently ignores
  // preventDefault() - handleWheel's own e.preventDefault() call below has
  // always been a no-op when attached via the JSX `onWheel` prop, so every
  // scroll-wheel zoom has ALSO scrolled the containing page at the same
  // time (confirmed live on production, and the root cause of a real user
  // report: zoom didn't feel like TradingView's, where the page never
  // moves). The fix is the standard workaround: attach the listener
  // imperatively with `{ passive: false }`, which JSX props can't express.
  // handleWheelRef always holds the LATEST render's handleWheel (closing
  // over the latest candles/etc.), so the listener itself never goes
  // stale no matter when its attaching effect (below) happens to run.
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const viewportRef = useRef<Viewport | null>(null);
  const crosshairRef = useRef<CrosshairState | null>(null);
  const dragRef = useRef<{ startX: number; startViewport: Viewport } | null>(null);
  const dimsRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  // Sprint D2.7.7, Phase 9 - a SEPARATE rAF handle from `rafRef` (which
  // throttles only the DOM hover-readout React state). This one coalesces
  // the actual Canvas redraw itself during a high-frequency pointer stream
  // (pan/pinch/hover) so a mouse/trackpad reporting faster than the
  // display's refresh rate never triggers more real `draw()` calls than
  // frames actually rendered. `draw()` always reads live refs at fire time,
  // so simply skipping a re-schedule while one is already pending (rather
  // than cancel-and-reschedule) is correct and slightly cheaper.
  const drawRafRef = useRef<number | null>(null);
  // Sprint D2.7.7, Phase 9 - mirrors the `isLive` React state so
  // applyViewport can skip calling setIsLive entirely when the value hasn't
  // actually changed, instead of invoking the state setter on every single
  // pointer-move tick of a drag/zoom gesture ("no setState per pointer
  // movement"). React's own bailout already avoids a re-render when the
  // value is unchanged, but this avoids even the wasted setState call.
  const isLiveRef = useRef(true);
  // Sprint D2.7.7, Phase 7 - unified pointer tracking (mouse, touch, pen
  // all deliver through the same Pointer Events API). Keyed by pointerId so
  // a second touch point can be tracked independently for pinch-zoom
  // without a second, parallel touch-event code path.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startViewport: Viewport } | null>(null);
  // Sprint D2.7.4 - tracks the symbol|timeframe key we last FIT REAL data
  // for (never the key we merely started loading). Fixes a real D2.7.3 bug:
  // the loading-state render used to stamp lastKeyRef with the new key
  // immediately, so when real candles arrived moments later for that same
  // key, the effect incorrectly took the "follow latest" branch against the
  // 1-hour fitToData([]) PLACEHOLDER viewport instead of genuinely fitting
  // the real data - producing an initial view whose span was always
  // exactly 1 hour regardless of the requested timeframe (e.g. a "1d"
  // chart with 300 daily candles would show almost none of them). See
  // docs/architecture/D2.7.4-native-chart-verification-ux-spec.md's bug log.
  const fittedKeyRef = useRef<string>("");

  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);

  // MT5 feature-parity Phase 1 - Drawing Tools state. Objects/selection are
  // held in BOTH a ref (drawingObjectsRef/selectedObjectIdRef - what draw()
  // actually reads, live, at call time - the exact same "refs for the
  // per-frame draw loop" discipline viewportRef/crosshairRef already
  // establish above) AND React state (drawingObjects/selectedObjectId -
  // what the JSX/DrawingToolbar render from, so the UI genuinely
  // re-renders on selection/count changes). commitDrawingObjects/
  // setSelectedObjectId below are the ONLY place either pair is written,
  // so the two never drift apart.
  const [activeTool, setActiveTool] = useState<DrawingToolId | null>(null);
  const [drawingObjects, setDrawingObjectsState] = useState<DrawingObject[]>([]);
  const [selectedObjectId, setSelectedObjectIdState] = useState<string | null>(null);
  const drawingObjectsRef = useRef<DrawingObject[]>([]);
  const selectedObjectIdRef = useRef<string | null>(null);
  // The in-progress first point of a 2-click tool (trendline/rectangle),
  // and the live pointer position while the second click hasn't landed
  // yet - together these drive the "rubber band" preview renderer.ts draws.
  const pendingPlacementRef = useRef<DrawingPoint | null>(null);
  const drawingPreviewRef = useRef<DrawingPreview | null>(null);
  // A drag on an EXISTING selected object's handle/body - deliberately a
  // separate ref from `dragRef` (chart panning) and `pinchRef`: object
  // dragging, chart panning, and pinch-zoom are mutually exclusive
  // gestures, never combined.
  const objectDragRef = useRef<{ objectId: string; handle: DrawingHandle; startPoint: DrawingPoint; original: DrawingObject } | null>(null);
  // Sprint D2.7.11 Phase 1b - readDrawingObjects/writeDrawingObjects are now
  // async (DB-backed, not sync sessionStorage). This tracks which
  // symbol|timeframe key's initial load has actually FINISHED, so the
  // write-effect below can tell "we just cleared local state because the
  // symbol changed and the real fetch hasn't resolved yet" apart from "the
  // user genuinely changed something" - without it, the write-effect would
  // PUT an empty array for the new key before its real saved objects ever
  // loaded, permanently wiping them out. Mirrors fittedKeyRef's own
  // established "has this effect actually completed for the current key"
  // pattern in this same file.
  const drawingsLoadedKeyRef = useRef<string>("");

  function commitDrawingObjects(objects: DrawingObject[]) {
    drawingObjectsRef.current = objects;
    setDrawingObjectsState(objects);
  }

  function setSelectedObjectId(id: string | null) {
    selectedObjectIdRef.current = id;
    setSelectedObjectIdState(id);
  }

  // Sprint D2.7.11 Phase 4 - saved chart templates: a named, reusable
  // bundle of active indicators + drawn objects (MT5's own real Template
  // feature). Deliberately fetched once on mount, never re-fetched per
  // symbol/timeframe switch - templates are a per-user library, not
  // scoped to one chart (see chart-template.service.ts's own header
  // comment for why).
  const [templates, setTemplates] = useState<ChartTemplate[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [templateActionPending, setTemplateActionPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTemplates().then((list) => {
      if (!cancelled) setTemplates(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveTemplate() {
    const name = saveNameInput.trim();
    if (!name) return;
    setTemplateActionPending(true);
    const saved = await saveTemplate(name, Array.from(activeIndicatorKeys), drawingObjectsRef.current);
    setTemplateActionPending(false);
    if (!saved) return; // best-effort - a failed save just leaves the modal open, never a silent false success
    setTemplates((prev) => [saved, ...prev.filter((t) => t.id !== saved.id)]);
    setSaveModalOpen(false);
    setSaveNameInput("");
  }

  /** Applying a template replaces BOTH halves of the bundle at once: the active indicator set (bubbles up to ChartPanel, which owns that state) and the current symbol/timeframe's drawn objects (local - commitDrawingObjects already triggers the existing persistence-write effect, so this is durably saved for the CURRENT chart exactly like any other edit). */
  function handleApplyTemplate(template: ChartTemplate) {
    onApplyIndicatorKeys(template.indicatorKeys);
    commitDrawingObjects(template.drawingObjects);
  }

  async function handleDeleteTemplate(id: string) {
    const ok = await deleteTemplate(id);
    if (ok) setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  /** The price panel's own row (top/height) within the canvas - drawing objects are scoped to the price panel only (Phase 1 - never a sub-panel), so every hit-test/placement must use THIS row's local coordinates, the same ones renderChart() itself uses internally (panel-layout.ts's computePanelLayout). */
  function priceRow() {
    const plotH = Math.max(0, dimsRef.current.height - TIME_AXIS_HEIGHT);
    const layout = computePanelLayout(activePanels, plotH);
    return layout.find((r) => r.id === "price") ?? { id: "price" as const, top: 0, height: plotH };
  }

  const candles = useMemo<ChartCandle[]>(() => result.series?.candles ?? [], [result.series]);

  const activeConfigs = useMemo(
    () => DEFAULT_INDICATOR_CONFIGS.filter((cfg) => activeIndicatorKeys.has(cfg.key)),
    [activeIndicatorKeys],
  );
  // Sprint D2.7.3, Phase 12 - recomputed only when candles or the active
  // indicator set change, never per pan/zoom/crosshair frame.
  const indicatorSeries = useMemo<IndicatorSeries[]>(
    () => activeConfigs.map((cfg) => computeIndicatorSeries(candles, cfg)),
    [candles, activeConfigs],
  );
  const activePanels = useMemo<ChartPanelId[]>(() => {
    const panels = new Set<ChartPanelId>();
    for (const series of indicatorSeries) if (series.panel !== "price") panels.add(series.panel);
    return Array.from(panels);
  }, [indicatorSeries]);

  const draw = useMemo(
    () => () => {
      const canvas = canvasRef.current;
      const viewport = viewportRef.current;
      if (!canvas || !viewport) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = dimsRef.current;
      if (width <= 0 || height <= 0) return;

      renderChart({
        ctx,
        dims: { width, height, priceAxisWidth: PRICE_AXIS_WIDTH, timeAxisHeight: TIME_AXIS_HEIGHT },
        candles,
        viewport,
        timeframe,
        crosshair: crosshairRef.current,
        // MT5-style theme (D2.7.2) - the Native Chart's canvas matches the
        // user's own live MetaTrader 5 terminal rather than AT24's original
        // token-driven palette. See canvas-colors.ts's header comment for
        // why this is a separate hardcoded palette rather than a change to
        // the shared --ink-2/--signal-up/--signal-down tokens. Sprint
        // D2.7.11 Phase 5c - which MT5 scheme is now itself a user choice
        // (Properties dialog, Colors tab) instead of a hardcoded "mt5"
        // literal; colorScheme defaults to "mt5" so this is zero visual
        // change until someone actually picks something else.
        colors: resolveChartColors(colorScheme),
        activePanels,
        indicatorSeries,
        symbolLabel: `${symbol}, ${timeframe.toUpperCase()}: ${name ?? symbol}`,
        // Read from refs, not the drawingObjects/selectedObjectId STATE
        // variables - the same reason viewport/crosshair are read via
        // viewportRef.current/crosshairRef.current above, not React
        // state: a drag gesture updates these every pointer-move tick via
        // scheduleDraw(), and re-reading fresh refs here (rather than
        // closing over a stale state value from whenever `draw` was last
        // recreated) is what makes that live update actually visible.
        drawingObjects: drawingObjectsRef.current,
        selectedDrawingObjectId: selectedObjectIdRef.current,
        drawingPreview: drawingPreviewRef.current,
        liveQuote,
        chartType,
        showGrid,
        showPeriodSeparators,
      });
    },
    [candles, timeframe, activePanels, indicatorSeries, symbol, name, liveQuote, chartType, showGrid, showPeriodSeparators, colorScheme],
  );

  // Resize: keep the canvas's real pixel buffer matched to its CSS size *
  // devicePixelRatio - Phase 15/13, no hardcoded dimensions, ResizeObserver-driven.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      dimsRef.current = { width, height };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // Sprint D2.7.3, Phase 5 - the visible-range/live-edge model. A
  // symbol/timeframe change always re-fits (a deliberate reset, matching
  // every charting platform's convention); a background poll's new
  // candles only shift the viewport when the user was already at the
  // right edge - a manual pan-back is NEVER forcibly overridden.
  //
  // Sprint D2.7.4 - fixed to key the "have we fit real data yet" check on
  // fittedKeyRef (only ever stamped once candles.length > 0), not on every
  // render including the empty loading-state one. Never runs fitToData/
  // followLatest against a 0-candle placeholder as if it were a real
  // "previous viewport" to follow from.
  useEffect(() => {
    const key = `${symbol}|${timeframe}`;

    if (candles.length === 0) {
      // Nothing real to fit yet - show the honest empty/placeholder
      // viewport, but deliberately do NOT stamp fittedKeyRef, so the next
      // render with real data for this same key still gets a genuine fit
      // instead of "following" this placeholder.
      viewportRef.current = fitToData(candles);
      crosshairRef.current = null;
      setHoveredIndex(-1);
      setIsLive(true);
      draw();
      return;
    }

    const previousViewport = viewportRef.current;
    const alreadyFittedForThisKey = fittedKeyRef.current === key;
    if (!alreadyFittedForThisKey || !previousViewport) {
      viewportRef.current = fitToData(candles);
      fittedKeyRef.current = key;
      crosshairRef.current = null;
      setHoveredIndex(-1);
      setIsLive(true);
    } else if (isAtRightEdge(previousViewport, candles)) {
      const followed = followLatest(previousViewport, candles);
      const { minPrice, maxPrice } = priceRangeForWindow(candles, followed.minTime, followed.maxTime);
      viewportRef.current = { ...followed, minPrice, maxPrice };
      setIsLive(true);
    } else {
      setIsLive(false);
    }
    draw();
  }, [candles, symbol, timeframe, draw]);

  // MT5 feature-parity Phase 1 - drawn objects are per symbol+timeframe
  // (matching MT5's own per-chart objects), loaded fresh whenever either
  // changes, and any in-progress placement/selection from the PREVIOUS
  // symbol/timeframe is discarded (a pending trendline click on the
  // PREVIOUS instrument means nothing once the symbol has changed).
  //
  // Sprint D2.7.11 Phase 1b - readDrawingObjects is now an async DB fetch,
  // not a sync sessionStorage read. Local state is cleared to an honest
  // empty set immediately (never show the PREVIOUS symbol's drawings on a
  // new one), then replaced once the real fetch resolves. `cancelled`
  // guards against a slow, now-stale fetch for a symbol/timeframe the user
  // has already navigated away from landing after a newer one already
  // finished - the exact same guard useChartCandles.ts already uses for
  // its own fetch effect.
  useEffect(() => {
    let cancelled = false;
    const key = `${symbol}|${timeframe}`;
    drawingsLoadedKeyRef.current = "";
    commitDrawingObjects([]);
    setSelectedObjectId(null);
    pendingPlacementRef.current = null;
    drawingPreviewRef.current = null;
    objectDragRef.current = null;

    readDrawingObjects(symbol, timeframe).then((objects) => {
      if (cancelled) return;
      commitDrawingObjects(objects);
      drawingsLoadedKeyRef.current = key;
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // Best-effort persistence (a durable DB table - see store.ts) every time
  // the committed object set actually changes. Deliberately does NOT fire
  // on ephemeral drag-preview updates (those mutate drawingObjectsRef.
  // current directly without calling commitDrawingObjects - see
  // handlePointerMove) so a drag doesn't write to storage on every
  // pointer-move tick, only once the gesture completes. Also skipped
  // entirely until drawingsLoadedKeyRef confirms the CURRENT symbol/
  // timeframe's initial load has actually finished - otherwise the empty
  // array the effect above commits while loading would itself trigger a
  // write here, overwriting real saved objects with [] before they ever
  // had a chance to load.
  useEffect(() => {
    const key = `${symbol}|${timeframe}`;
    if (drawingsLoadedKeyRef.current !== key) return;
    writeDrawingObjects(symbol, timeframe, drawingObjects);
  }, [symbol, timeframe, drawingObjects]);

  function scheduleHoverUpdate(index: number) {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setHoveredIndex(index);
      rafRef.current = null;
    });
  }

  // Sprint D2.7.7, Phase 9 - see drawRafRef's own comment. Skips scheduling
  // (rather than cancel+reschedule) when a frame is already pending, since
  // `draw()` reads viewportRef/crosshairRef live at fire time - the pending
  // frame always picks up whatever the latest pointer position produced.
  function scheduleDraw() {
    if (drawRafRef.current !== null) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = null;
      draw();
    });
  }

  function plotWidth() {
    return Math.max(0, dimsRef.current.width - PRICE_AXIS_WIDTH);
  }

  function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Sprint D2.7.7, Phase 2 - `coalesce` routes the redraw through the
  // rAF-coalesced `scheduleDraw()` for high-frequency callers (pan/zoom/
  // pinch pointer streams) instead of the immediate, synchronous `draw()`
  // every other (rare, discrete) caller - Fit/Go-Live/keyboard nav - still
  // uses, where instant visual feedback is preferable and there's no event-
  // flooding risk. `isLiveRef` lets this skip the `setIsLive` state-setter
  // call entirely on ticks where the live/not-live status hasn't actually
  // changed, rather than invoking it unconditionally on every single
  // pointer-move tick of a drag/zoom gesture.
  function applyViewport(next: Viewport, coalesce = false) {
    const { minPrice, maxPrice } = priceRangeForWindow(candles, next.minTime, next.maxTime);
    viewportRef.current = { ...next, minPrice, maxPrice };
    const live = isAtRightEdge(viewportRef.current, candles);
    if (live !== isLiveRef.current) {
      isLiveRef.current = live;
      setIsLive(live);
    }
    if (coalesce) scheduleDraw();
    else draw();
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    // Gapless x-axis (this session) - the zoom anchor must agree with what's
    // actually rendered at this pixel (index-based), not plain linear-time
    // math, or zooming near a compressed real-time gap would center on the
    // wrong candle. zoomViewport/clampViewportToCandleBounds themselves stay
    // real-time-based (unchanged) - only the ANCHOR lookup goes through the
    // index bridge.
    const range = indexRangeForViewport(candles, viewport);
    const anchorTime = fractionalIndexToTime(candles, xToIndex(x, range, plotWidth()));
    const factor = e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    const zoomed = zoomViewport(viewport, factor, anchorTime, candleStepMs(candles), candles.length);
    applyViewport(clampViewportToCandleBounds(zoomed, candles), true);
  }
  handleWheelRef.current = handleWheel;

  // Sprint D2.7.11 - see handleWheelRef's own comment above for why this
  // can't be the JSX `onWheel` prop. Always dispatches to
  // handleWheelRef.current, so it never goes stale on its own.
  //
  // Bug found live on production (this session): an empty `[]` dependency
  // array here looked right ("attach once on mount") but was actually
  // broken - this component early-returns a loading <StateMessage/> (see
  // the `result.status === "loading"` branch below) with NO canvas at all
  // for the component's very FIRST render, since useChartCandles's own
  // initial state is always `{status: "loading"}`. That first render is
  // exactly when a `[]`-effect fires - canvasRef.current is null, the
  // guard below no-ops, and because the deps never change, this effect
  // then NEVER runs again for the rest of the component's lifetime, even
  // once real candles arrive and the real canvas mounts a few renders
  // later. The listener silently never attaches at all - wheel-zoom still
  // "worked" (handleWheel ran via events that happened to reach it some
  // other way in dev, masking the bug) but preventDefault never took
  // effect on the REAL attached listener because there wasn't one.
  // Depending on `[draw]` instead - the exact same dependency the
  // ResizeObserver effect above already uses - re-runs this effect the
  // moment `draw` changes identity, which happens whenever `candles`
  // transitions from empty to populated (loading -> ready), so the
  // listener gets attached to the real canvas as soon as it exists. It
  // also re-attaches on every later candles poll (same as the
  // ResizeObserver effect already does, functionally harmless since the
  // cleanup always removes the previous listener first).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listener = (e: WheelEvent) => handleWheelRef.current(e);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [draw]);

  // Sprint D2.7.7, Phase 2/7 - migrated from Mouse Events to the unified
  // Pointer Events API (mouse/touch/pen all deliver through this one model)
  // for two genuine reasons found in the Phase 1 audit: (1) native mouse
  // events have no capture mechanism, so a real drag that ends with the
  // button released OUTSIDE the canvas (extremely common - a fast drag) NEVER
  // fires the canvas's own mouseup at all, permanently leaving `dragRef` set
  // and stuck-panning every subsequent hover; setPointerCapture below fixes
  // this at the source. (2) Pointer Events fire for touch input too, giving
  // real single-finger pan and (via activePointersRef tracking two points)
  // pinch-zoom for free, with zero duplicate/parallel event-handling code.
  /** MT5 feature-parity Phase 1 - handles a click while a drawing tool is active: the horizontal-line tool commits on the first click (it only ever needs one price), trendline/rectangle need a second click (tracked via pendingPlacementRef, rendered live via drawingPreviewRef in the meantime). Silently does nothing for a click outside the price row - Phase 1 objects are price-panel only. */
  function handleDrawingPlacementClick(x: number, y: number) {
    const viewport = viewportRef.current;
    if (!viewport || !activeTool) return;
    const row = priceRow();
    if (y < row.top || y > row.top + row.height) return;
    const range = indexRangeForViewport(candles, viewport);
    const point = pixelToPoint(x, y - row.top, candles, range, viewport, plotWidth(), row.height);
    const nowMs = Date.now();

    if (activeTool === "horizontal-line") {
      const obj = createHorizontalLine(point.price, nowMs);
      commitDrawingObjects([...drawingObjectsRef.current, obj]);
      setSelectedObjectId(obj.id);
      setActiveTool(null);
      draw();
      return;
    }

    if (!pendingPlacementRef.current) {
      pendingPlacementRef.current = point;
      drawingPreviewRef.current = { tool: activeTool, p1: point, p2: point };
      draw();
      return;
    }

    const p1 = pendingPlacementRef.current;
    const obj =
      activeTool === "trendline"
        ? createTrendLine(p1, point, nowMs)
        : activeTool === "fibonacci"
          ? createFibonacci(p1, point, nowMs)
          : createRectangle(p1, point, nowMs);
    commitDrawingObjects([...drawingObjectsRef.current, obj]);
    setSelectedObjectId(obj.id);
    pendingPlacementRef.current = null;
    drawingPreviewRef.current = null;
    setActiveTool(null);
    draw();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !viewportRef.current) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    activePointersRef.current.set(e.pointerId, { x, y });

    // MT5 feature-parity Phase 1 - drawing-tool placement/selection is a
    // single-pointer-only interaction that always takes priority over
    // pan/pinch when applicable, and returns early to skip them entirely.
    // Falls through to the existing pan/pinch logic below completely
    // unchanged whenever there's nothing to draw/select - the overwhelming
    // majority of clicks.
    if (activePointersRef.current.size === 1 && x <= plotWidth()) {
      const viewport = viewportRef.current;
      if (activeTool) {
        handleDrawingPlacementClick(x, y);
        return;
      }
      const row = priceRow();
      if (y >= row.top && y <= row.top + row.height) {
        const range = indexRangeForViewport(candles, viewport);
        const hit = hitTestObjects(drawingObjectsRef.current, x, y - row.top, candles, range, viewport, plotWidth(), row.height);
        if (hit) {
          const target = drawingObjectsRef.current.find((o) => o.id === hit.objectId);
          if (target) {
            setSelectedObjectId(hit.objectId);
            objectDragRef.current = {
              objectId: hit.objectId,
              handle: hit.handle,
              startPoint: pixelToPoint(x, y - row.top, candles, range, viewport, plotWidth(), row.height),
              original: target,
            };
            draw();
            return;
          }
        } else if (selectedObjectIdRef.current !== null) {
          setSelectedObjectId(null);
          draw();
        }
      }
    }

    if (activePointersRef.current.size === 2) {
      // A second finger just landed - this gesture is now a pinch, not a
      // pan. Cancel any single-finger drag in progress and capture the
      // real starting distance/viewport to zoom relative to.
      dragRef.current = null;
      const points = Array.from(activePointersRef.current.values());
      const startDistance = pointerDistance(points[0], points[1]);
      if (startDistance > 0) pinchRef.current = { startDistance, startViewport: viewportRef.current };
    } else if (activePointersRef.current.size === 1) {
      dragRef.current = { startX: e.clientX, startViewport: viewportRef.current };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (activePointersRef.current.has(e.pointerId)) activePointersRef.current.set(e.pointerId, { x, y });

    // MT5 feature-parity Phase 1 - live "rubber band" preview while a
    // 2-click tool's first point is placed but the second hasn't landed.
    if (pendingPlacementRef.current && drawingPreviewRef.current && viewportRef.current) {
      const row = priceRow();
      const range = indexRangeForViewport(candles, viewportRef.current);
      const point = pixelToPoint(x, y - row.top, candles, range, viewportRef.current, plotWidth(), row.height);
      drawingPreviewRef.current = { tool: drawingPreviewRef.current.tool, p1: pendingPlacementRef.current, p2: point };
      scheduleDraw();
      return;
    }

    // MT5 feature-parity Phase 1 - live drag of a selected object's
    // handle/body. Mutates drawingObjectsRef.current DIRECTLY (never
    // commitDrawingObjects/setState here) so a drag doesn't trigger a
    // React re-render or a sessionStorage write on every pointer-move
    // tick - the same performance discipline applyViewport's own pan/
    // zoom already follows for the viewport itself (see this file's
    // header comment on drawRafRef).
    if (objectDragRef.current && viewportRef.current) {
      const { objectId, handle, startPoint, original } = objectDragRef.current;
      const row = priceRow();
      const range = indexRangeForViewport(candles, viewportRef.current);
      const current = pixelToPoint(x, y - row.top, candles, range, viewportRef.current, plotWidth(), row.height);
      const deltaTime = current.time - startPoint.time;
      const deltaPrice = current.price - startPoint.price;
      const updated = applyDrag(original, handle, deltaTime, deltaPrice);
      drawingObjectsRef.current = drawingObjectsRef.current.map((o) => (o.id === objectId ? updated : o));
      scheduleDraw();
      return;
    }

    // Sprint D2.7.7, Phase 7 - two-finger pinch zoom, reusing the SAME
    // zoomViewport already used by wheel/keyboard zoom - never a second
    // zoom model. The anchor is the real midpoint between the two live
    // touch points (converted to a time via the same ratio math handleWheel
    // already uses), so the content between the fingers stays fixed, the
    // standard pinch-zoom feel.
    if (pinchRef.current && activePointersRef.current.size === 2) {
      const points = Array.from(activePointersRef.current.values());
      const distance = pointerDistance(points[0], points[1]);
      const { startDistance, startViewport } = pinchRef.current;
      if (distance > 0 && startDistance > 0) {
        const factor = startDistance / distance; // fingers spreading (distance grows) -> factor<1 -> zoom in
        const midX = (points[0].x + points[1].x) / 2;
        const pinchRange = indexRangeForViewport(candles, startViewport);
        const anchorTime = fractionalIndexToTime(candles, xToIndex(midX, pinchRange, Math.max(1, plotWidth())));
        const zoomed = zoomViewport(startViewport, factor, anchorTime, candleStepMs(candles), candles.length);
        applyViewport(clampViewportToCandleBounds(zoomed, candles), true);
      }
      return;
    }

    if (dragRef.current) {
      const { startX, startViewport } = dragRef.current;
      const deltaPx = e.clientX - startX;
      const span = startViewport.maxTime - startViewport.minTime;
      const deltaMs = -(deltaPx / Math.max(1, plotWidth())) * span;
      const panned = clampViewportToCandleBounds(panViewport(startViewport, deltaMs), candles);
      applyViewport(panned, true);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0 || x > plotWidth()) {
      crosshairRef.current = null;
      scheduleHoverUpdate(-1);
      scheduleDraw();
      return;
    }
    const index = nearestCandleIndex(candles, viewport, x, plotWidth());
    if (index === -1) return;
    crosshairRef.current = { index, x, y };
    scheduleHoverUpdate(index);
    scheduleDraw();
  }

  // Sprint D2.7.7, Phase 2 - shared pointerup/pointercancel cleanup. Both
  // events mean this pointer is gone for good (cancel fires for e.g. a
  // touch gesture the OS reinterprets as a system gesture mid-stream) -
  // treated identically so neither path can leave stale drag/pinch state
  // behind ("chart must never become permanently stuck in dragging mode").
  function releasePointer(e: React.PointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) dragRef.current = null;
    // MT5 feature-parity Phase 1 - a drag gesture only ever mutates
    // drawingObjectsRef directly (see handlePointerMove); this is the
    // ONE place that finalizes it into real state - triggering a single
    // re-render and a single sessionStorage write per drag, not one per
    // pointer-move tick.
    if (objectDragRef.current) {
      commitDrawingObjects([...drawingObjectsRef.current]);
      objectDragRef.current = null;
    }
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // already released (e.g. the browser released it implicitly on cancel) - never fatal
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    releasePointer(e);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    releasePointer(e);
  }

  // Sprint D2.7.7 - unlike the old mouseleave-based handler, this does NOT
  // clear an active drag: with real pointer capture in effect, `pointermove`
  // keeps being delivered to the canvas even once the cursor visually exits
  // its bounds (the correct, professional behavior - a fast drag shouldn't
  // abruptly stop just because the cursor grazed past the chart's edge).
  // Only the idle crosshair-hover state is cleared here.
  function handlePointerLeave() {
    if (dragRef.current || pinchRef.current) return;
    crosshairRef.current = null;
    scheduleHoverUpdate(-1);
    scheduleDraw();
  }

  function handleDoubleClick() {
    handleFit();
  }

  function handleFit() {
    if (candles.length === 0) return;
    viewportRef.current = fitToData(candles);
    const live = isAtRightEdge(viewportRef.current, candles);
    isLiveRef.current = live;
    setIsLive(live);
    draw();
  }

  function handleGoLive() {
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    applyViewport(followLatest(viewport, candles));
  }

  // MT5 feature-parity Phase 1 - the toolbar's own Delete/Clear-all
  // buttons, sharing the exact same commit path as the keyboard Delete
  // handler above (never a second/divergent deletion code path).
  function handleDeleteSelectedDrawing() {
    if (!selectedObjectIdRef.current) return;
    const id = selectedObjectIdRef.current;
    commitDrawingObjects(drawingObjectsRef.current.filter((o) => o.id !== id));
    setSelectedObjectId(null);
    draw();
  }

  function handleClearAllDrawings() {
    if (drawingObjectsRef.current.length === 0) return;
    commitDrawingObjects([]);
    setSelectedObjectId(null);
    draw();
  }

  function handleSelectDrawingTool(tool: DrawingToolId | null) {
    // Switching tools (or back to cursor) mid-placement abandons whatever
    // was pending - never silently completes a trendline with the WRONG
    // second tool's semantics.
    pendingPlacementRef.current = null;
    drawingPreviewRef.current = null;
    setActiveTool(tool);
    draw();
  }

  function handleToggleFullscreen() {
    setIsFullscreen((v) => !v);
  }

  // Sprint D2.7.5, Phase 9 - Escape always exits fullscreen, the one
  // required global shortcut fullscreen UX needs. Scoped to `window` (not
  // the canvas) so it works even when focus is elsewhere in the fullscreen
  // header/toolbar, and only attached while actually fullscreen so it never
  // steals Escape from the rest of the Workspace otherwise.
  useEffect(() => {
    if (!isFullscreen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  // Sprint D2.7.3, Phase 4 - keyboard navigation: left/right pan by a few
  // candles, +/- zoom centered on the current view's midpoint. Only active
  // while the canvas itself has focus (tabIndex below), so it never
  // hijacks page-level scrolling/keyboard use elsewhere in the Workspace.
  //
  // Sprint D2.7.7, Phase 8 - Escape now cancels any transient interaction
  // state (an in-progress drag/pinch, an active crosshair hover) - the one
  // keyboard escape hatch Phase 8 explicitly asks for. Deliberately does
  // NOT call stopPropagation: the separate window-level Escape listener
  // (fullscreen exit, D2.7.5) still fires too if applicable, so a single
  // Escape press correctly handles both scopes at once.
  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (e.key === "Escape") {
      dragRef.current = null;
      pinchRef.current = null;
      activePointersRef.current.clear();
      // MT5 feature-parity Phase 1 - Escape also cancels a mid-placement
      // 2-click tool and an in-progress object drag, returning to cursor
      // mode - the same "universal cancel" role Escape already plays for
      // drag/pinch/crosshair below.
      const hadPendingDrawing = pendingPlacementRef.current !== null || objectDragRef.current !== null || activeTool !== null;
      pendingPlacementRef.current = null;
      drawingPreviewRef.current = null;
      objectDragRef.current = null;
      if (activeTool) setActiveTool(null);
      if (crosshairRef.current) {
        crosshairRef.current = null;
        scheduleHoverUpdate(-1);
        draw();
      } else if (hadPendingDrawing) {
        draw();
      }
      return;
    }
    // MT5 feature-parity Phase 1 - Delete/Backspace removes the currently
    // selected drawn object. Independent of the viewport/candles guard
    // below - deleting a selection doesn't need either.
    if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectIdRef.current) {
      e.preventDefault();
      const id = selectedObjectIdRef.current;
      commitDrawingObjects(drawingObjectsRef.current.filter((o) => o.id !== id));
      setSelectedObjectId(null);
      draw();
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    const step = candleStepMs(candles);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const direction = e.key === "ArrowLeft" ? -1 : 1;
      const panned = clampViewportToCandleBounds(panViewport(viewport, direction * step * PAN_KEY_STEP_CANDLES), candles);
      applyViewport(panned, true);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      const mid = (viewport.minTime + viewport.maxTime) / 2;
      const zoomed = clampViewportToCandleBounds(zoomViewport(viewport, ZOOM_IN_FACTOR, mid, step, candles.length), candles);
      applyViewport(zoomed, true);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const mid = (viewport.minTime + viewport.maxTime) / 2;
      const zoomed = clampViewportToCandleBounds(zoomViewport(viewport, ZOOM_OUT_FACTOR, mid, step, candles.length), candles);
      applyViewport(zoomed, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      handleFit();
    } else if (e.key === "End") {
      e.preventDefault();
      handleGoLive();
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (drawRafRef.current !== null) cancelAnimationFrame(drawRafRef.current);
    };
  }, []);

  // Sprint D2.7.7, Phase 2/7 - a belt-and-suspenders safety net against a
  // "stuck dragging" chart: pointer capture (see handlePointerDown) already
  // guarantees pointerup/pointercancel fire on the canvas regardless of
  // where the cursor physically is, but a window blur (alt-tab, a native
  // OS dialog stealing focus, devtools opening) can leave a pointer "down"
  // without the browser ever delivering a pointerup/cancel event at all.
  // Always-on (not only while dragging) since the check itself is free.
  useEffect(() => {
    function resetInteractionState() {
      dragRef.current = null;
      pinchRef.current = null;
      activePointersRef.current.clear();
    }
    window.addEventListener("blur", resetInteractionState);
    return () => window.removeEventListener("blur", resetInteractionState);
  }, []);

  const containerHeight = BASE_PANEL_HEIGHT + activePanels.length * SUB_PANEL_HEIGHT;

  if (!resolution.supported) {
    return (
      <StateMessage
        primary={`Chart visualization is unavailable for ${resolution.displaySymbol}.`}
        secondary={resolution.reason}
        height={containerHeight}
      />
    );
  }

  if (result.status === "loading") {
    return <StateMessage primary="Loading chart data…" height={containerHeight} />;
  }
  if (result.status === "unsupported") {
    return <StateMessage primary="Native chart data is unavailable for this instrument." secondary={result.message} height={containerHeight} />;
  }
  if (result.status === "error") {
    return <StateMessage primary="Chart data is temporarily unavailable." secondary={result.message} height={containerHeight} />;
  }
  if (result.status === "empty") {
    return <StateMessage primary="No candle data is available yet for this symbol and timeframe." height={containerHeight} />;
  }

  const hoveredCandle = hoveredIndex >= 0 && hoveredIndex < candles.length ? candles[hoveredIndex] : null;
  const trend = hoveredCandle ? classifyCandle(hoveredCandle) : null;

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 flex flex-col gap-2 bg-ink p-4" : "flex flex-col gap-2"}>
      <ChartHeader displaySymbol={resolution.displaySymbol} instrumentName={name} timeframe={timeframe} series={result.series} />
      <MicrostructurePanel symbol={symbol} hypothesisType={symbol === activeSymbol ? hypothesisType : undefined} />
      <ChartToolbar
        displaySymbol={resolution.displaySymbol}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        chartType={chartType}
        onChartTypeChange={setChartType}
        activeIndicatorKeys={activeIndicatorKeys}
        onToggleIndicator={onToggleIndicator}
        onFit={handleFit}
        onGoLive={handleGoLive}
        isLive={isLive}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        templates={templates}
        onApplyTemplate={handleApplyTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        onOpenSaveTemplate={() => setSaveModalOpen(true)}
        onOpenProperties={() => setPropertiesModalOpen(true)}
      />

      <Modal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save as Template">
        <p className="text-xs text-text-3">
          Saves the current active indicators and drawn objects as a reusable template. Saving under an existing name overwrites it.
        </p>
        <input
          type="text"
          value={saveNameInput}
          onChange={(e) => setSaveNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveTemplate();
          }}
          placeholder="Template name"
          maxLength={60}
          autoFocus
          className="mt-3 w-full rounded-control border border-border bg-ink-3 px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-gold focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setSaveModalOpen(false)}
            className="rounded-control border border-border bg-ink-3 px-3 py-1.5 text-xs font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={saveNameInput.trim().length === 0 || templateActionPending}
            className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {templateActionPending ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>

      <Modal open={propertiesModalOpen} onClose={() => setPropertiesModalOpen(false)} title="Chart Properties">
        <p className={`${FIN_LABEL} pb-1`}>Show</p>
        <label className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1.5 text-xs text-text-2 hover:bg-ink-3">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="accent-gold" />
          Grid
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1.5 text-xs text-text-2 hover:bg-ink-3">
          <input type="checkbox" checked={showPeriodSeparators} onChange={(e) => setShowPeriodSeparators(e.target.checked)} className="accent-gold" />
          Period separators
        </label>
        <p className={`${FIN_LABEL} pb-1 pt-3`}>Colors</p>
        <select
          value={colorScheme}
          onChange={(e) => setColorScheme(e.target.value as ChartTheme)}
          aria-label="Chart color scheme"
          className="w-full rounded-control border border-border bg-ink-3 px-2 py-1.5 text-xs text-text focus:border-gold focus:outline-none"
        >
          {COLOR_SCHEMES.map((scheme) => (
            <option key={scheme} value={scheme}>
              {CHART_THEME_LABELS[scheme]}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setPropertiesModalOpen(false)}
            className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition hover:bg-gold/20"
          >
            Done
          </button>
        </div>
      </Modal>

      <DrawingToolbar
        activeTool={activeTool}
        onSelectTool={handleSelectDrawingTool}
        hasSelection={selectedObjectId !== null}
        onDeleteSelected={handleDeleteSelectedDrawing}
        objectCount={drawingObjects.length}
        onClearAll={handleClearAllDrawings}
      />

      {result.status === "stale" && (
        <p className={FIN_TERTIARY}>Showing the most recently available data - a live refresh could not be confirmed as fresh.</p>
      )}

      {hoveredCandle ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={FIN_LABEL}>{formatTimestamp(hoveredCandle.time, "datetime")}</span>
          <OhlcField label="O" value={hoveredCandle.open} />
          <OhlcField label="H" value={hoveredCandle.high} />
          <OhlcField label="L" value={hoveredCandle.low} />
          <span className={`${FIN_PRIMARY} ${trend ? financialDirectionClass(trend === "bullish" ? "up" : trend === "bearish" ? "down" : "neutral") : ""}`}>
            C {formatPrice(hoveredCandle.close, { maxDecimals: 5 })}
          </span>
          {hoveredCandle.volume !== undefined && <span className={FIN_SECONDARY}>V {formatCompactVolume(hoveredCandle.volume)}</span>}
          {indicatorSeries.map((series) => {
            const values = valueAtIndex(series, hoveredIndex);
            return series.lines.map((line, i) =>
              values[i] === undefined ? null : (
                <span key={line.name} className={FIN_SECONDARY}>
                  {line.name.toUpperCase()} {formatPrice(values[i] as number, { maxDecimals: 5 })}
                </span>
              ),
            );
          })}
        </div>
      ) : (
        <span className={FIN_LABEL}>Native chart (beta)</span>
      )}

      <div
        ref={containerRef}
        className={isFullscreen ? "relative w-full min-h-0 flex-1" : "relative w-full"}
        style={isFullscreen ? undefined : { height: containerHeight }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          // Sprint D2.7.7, Phase 8 - `outline-none` previously opted this
          // canvas OUT of the site-wide `:focus-visible` gold-ring rule
          // (app/globals.css) every other focusable element already gets -
          // a real, previously-invisible keyboard-focus gap. Removing it
          // lets the SAME existing rule apply here too, no new CSS.
          className="h-full w-full cursor-crosshair"
          // Sprint D2.7.7, Phase 7 - tells the browser never to interpret a
          // single- or two-finger touch on the canvas as a native
          // scroll/pinch-zoom/navigation gesture, so our own pointer-event
          // pan/pinch logic is the only thing handling touch input here.
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        />
      </div>
      {result.series && result.series.rejectedCount > 0 && (
        <p className="text-xs text-text-3">
          {result.series.rejectedCount} candle{result.series.rejectedCount === 1 ? "" : "s"} were excluded for failing data-integrity checks.
        </p>
      )}
      {result.series && <ProvenanceDisclosure series={result.series} />}
    </div>
  );
}

// Sprint D2.7.4, Phase 9 - the provenance/freshness disclosure target the
// sprint brief names explicitly. Every value here is real, read straight
// off the already-fetched ChartSeries (D2.7.3's provider/fallbackUsed/
// cached/cacheAgeMs/freshness fields) - never a second data source, never
// a guess when a field is genuinely absent.
function ProvenanceDisclosure({ series }: { series: ChartSeries }) {
  const parts: string[] = [];
  if (series.provider) parts.push(series.provider + (series.fallbackUsed ? " (fallback)" : ""));
  if (series.cached) parts.push(`cached ${formatDuration(series.cacheAgeMs ?? 0)} ago`);
  if (series.freshness) parts.push(series.freshness);
  if (parts.length === 0) return null;
  return <p className={FIN_TERTIARY}>{parts.join(" · ")}</p>;
}

function OhlcField({ label, value }: { label: string; value: number }) {
  return (
    <span className={FIN_SECONDARY}>
      {label} {formatPrice(value, { maxDecimals: 5 })}
    </span>
  );
}

function StateMessage({ primary, secondary, height }: { primary: string; secondary?: string; height: number }) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-1.5 rounded-panel border border-border bg-ink-2 px-4 text-center"
      style={{ height }}
    >
      <p className="text-sm text-text-2">{primary}</p>
      {secondary && <p className="text-xs text-text-3">{secondary}</p>}
    </div>
  );
}
