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
import { resolveChartColors } from "@/lib/chart-engine/canvas-colors";
import { nearestCandleIndex } from "@/lib/chart-engine/crosshair";
import { renderChart } from "@/lib/chart-engine/renderer";
import {
  candleStepMs,
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
import type { ChartCandle, ChartSeries } from "@/types/chart-data";
import type { CrosshairState, Viewport } from "@/lib/chart-engine/types";
import type { SignalTimeframe } from "@/types/signal";
import type { ChartPanelId, IndicatorSeries } from "@/lib/chart-engine/indicators/types";
import { useChartCandles } from "./useChartCandles";
import ChartToolbar from "./ChartToolbar";

const PRICE_AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 22;
const ZOOM_IN_FACTOR = 0.9;
const ZOOM_OUT_FACTOR = 1.1;
const BASE_PANEL_HEIGHT = 380;
const SUB_PANEL_HEIGHT = 110;
const PAN_KEY_STEP_CANDLES = 5;

export interface NativeChartProps {
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
}

export default function NativeChart({ timeframe, onTimeframeChange, activeIndicatorKeys, onToggleIndicator }: NativeChartProps) {
  const { symbol } = useWorkspace();
  const [isLive, setIsLive] = useState(true);
  const resolution = resolveChartInstrument(symbol);
  const result = useChartCandles(symbol, timeframe);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const crosshairRef = useRef<CrosshairState | null>(null);
  const dragRef = useRef<{ startX: number; startViewport: Viewport } | null>(null);
  const dimsRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
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
        colors: resolveChartColors(),
        activePanels,
        indicatorSeries,
      });
    },
    [candles, timeframe, activePanels, indicatorSeries],
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

  function scheduleHoverUpdate(index: number) {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setHoveredIndex(index);
      rafRef.current = null;
    });
  }

  function plotWidth() {
    return Math.max(0, dimsRef.current.width - PRICE_AXIS_WIDTH);
  }

  function applyViewport(next: Viewport) {
    const { minPrice, maxPrice } = priceRangeForWindow(candles, next.minTime, next.maxTime);
    viewportRef.current = { ...next, minPrice, maxPrice };
    setIsLive(isAtRightEdge(viewportRef.current, candles));
    draw();
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const anchorTime = viewport.minTime + (x / plotWidth()) * (viewport.maxTime - viewport.minTime);
    const factor = e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    applyViewport(zoomViewport(viewport, factor, anchorTime, candleStepMs(candles)));
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!viewportRef.current) return;
    dragRef.current = { startX: e.clientX, startViewport: viewportRef.current };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragRef.current) {
      const { startX, startViewport } = dragRef.current;
      const deltaPx = e.clientX - startX;
      const span = startViewport.maxTime - startViewport.minTime;
      const deltaMs = -(deltaPx / Math.max(1, plotWidth())) * span;
      applyViewport(panViewport(startViewport, deltaMs));
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0 || x > plotWidth()) {
      crosshairRef.current = null;
      scheduleHoverUpdate(-1);
      draw();
      return;
    }
    const index = nearestCandleIndex(candles, viewport, x, plotWidth());
    if (index === -1) return;
    crosshairRef.current = { index, x, y };
    scheduleHoverUpdate(index);
    draw();
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  function handleMouseLeave() {
    dragRef.current = null;
    crosshairRef.current = null;
    scheduleHoverUpdate(-1);
    draw();
  }

  function handleDoubleClick() {
    handleFit();
  }

  function handleFit() {
    if (candles.length === 0) return;
    viewportRef.current = fitToData(candles);
    setIsLive(isAtRightEdge(viewportRef.current, candles));
    draw();
  }

  function handleGoLive() {
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    applyViewport(followLatest(viewport, candles));
  }

  // Sprint D2.7.3, Phase 4 - keyboard navigation: left/right pan by a few
  // candles, +/- zoom centered on the current view's midpoint. Only active
  // while the canvas itself has focus (tabIndex below), so it never
  // hijacks page-level scrolling/keyboard use elsewhere in the Workspace.
  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0) return;
    const step = candleStepMs(candles);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const direction = e.key === "ArrowLeft" ? -1 : 1;
      applyViewport(panViewport(viewport, direction * step * PAN_KEY_STEP_CANDLES));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      const mid = (viewport.minTime + viewport.maxTime) / 2;
      applyViewport(zoomViewport(viewport, ZOOM_IN_FACTOR, mid, step));
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const mid = (viewport.minTime + viewport.maxTime) / 2;
      applyViewport(zoomViewport(viewport, ZOOM_OUT_FACTOR, mid, step));
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
    };
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
    <div className="flex flex-col gap-2">
      <ChartToolbar
        displaySymbol={resolution.displaySymbol}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        activeIndicatorKeys={activeIndicatorKeys}
        onToggleIndicator={onToggleIndicator}
        onFit={handleFit}
        onGoLive={handleGoLive}
        isLive={isLive}
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

      <div ref={containerRef} className="relative w-full" style={{ height: containerHeight }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="h-full w-full cursor-crosshair outline-none"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
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
