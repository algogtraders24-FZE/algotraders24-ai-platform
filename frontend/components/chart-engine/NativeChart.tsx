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
// Performance (Phase 14): pan/zoom/crosshair interaction updates a
// `viewportRef`/`crosshairRef` and calls `draw()` directly - it does NOT
// go through React state on every mousemove, so a drag or zoom gesture
// never triggers a React re-render per frame. React state is used only
// for the rarer events (data load, resize, timeframe change) and for the
// DOM-rendered OHLC readout (throttled to one state update per animation
// frame), which needs D2.7.1's FIN_* typography classes - something
// canvas text cannot apply.
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatPrice, formatTimestamp } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, financialDirectionClass } from "@/components/ui/financial-typography";
import { resolveChartInstrument } from "@/lib/market-data/chart-instrument-resolver";
import { resolveChartColors } from "@/lib/chart-engine/canvas-colors";
import { nearestCandleIndex } from "@/lib/chart-engine/crosshair";
import { renderChart } from "@/lib/chart-engine/renderer";
import { candleStepMs, fitToData, panViewport, priceRangeForWindow, zoomViewport } from "@/lib/chart-engine/viewport";
import { classifyCandle } from "@/lib/chart-engine/candle-classifier";
import type { ChartCandle } from "@/types/chart-data";
import type { CrosshairState, Viewport } from "@/lib/chart-engine/types";
import type { SignalTimeframe } from "@/types/signal";
import { useChartCandles } from "./useChartCandles";
import ChartTimeframeSelector from "./ChartTimeframeSelector";

const PRICE_AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 22;
const ZOOM_IN_FACTOR = 0.9;
const ZOOM_OUT_FACTOR = 1.1;

export default function NativeChart() {
  const { symbol } = useWorkspace();
  const [timeframe, setTimeframe] = useState<SignalTimeframe>("1h");
  const resolution = resolveChartInstrument(symbol);
  const result = useChartCandles(symbol, timeframe);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const crosshairRef = useRef<CrosshairState | null>(null);
  const dragRef = useRef<{ startX: number; startViewport: Viewport } | null>(null);
  const dimsRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);

  const [hoveredCandle, setHoveredCandle] = useState<ChartCandle | null>(null);

  const candles = useMemo<ChartCandle[]>(() => result.series?.candles ?? [], [result.series]);

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
      });
    },
    [candles, timeframe],
  );

  // Resize: keep the canvas's real pixel buffer matched to its CSS size *
  // devicePixelRatio - Phase 15, no hardcoded dimensions, ResizeObserver-driven.
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

  // New/changed series: fit the viewport to the freshly loaded data.
  useEffect(() => {
    viewportRef.current = fitToData(candles);
    crosshairRef.current = null;
    setHoveredCandle(null);
    draw();
  }, [candles, draw]);

  function scheduleHoverUpdate(candle: ChartCandle | null) {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setHoveredCandle(candle);
      rafRef.current = null;
    });
  }

  function plotWidth() {
    return Math.max(0, dimsRef.current.width - PRICE_AXIS_WIDTH);
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
    const zoomed = zoomViewport(viewport, factor, anchorTime, candleStepMs(candles));
    const { minPrice, maxPrice } = priceRangeForWindow(candles, zoomed.minTime, zoomed.maxTime);
    viewportRef.current = { ...zoomed, minPrice, maxPrice };
    draw();
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
      const panned = panViewport(startViewport, deltaMs);
      const { minPrice, maxPrice } = priceRangeForWindow(candles, panned.minTime, panned.maxTime);
      viewportRef.current = { ...panned, minPrice, maxPrice };
      draw();
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport || candles.length === 0 || x > plotWidth()) {
      crosshairRef.current = null;
      scheduleHoverUpdate(null);
      draw();
      return;
    }
    const index = nearestCandleIndex(candles, viewport, x, plotWidth());
    if (index === -1) return;
    crosshairRef.current = { index, x, y };
    scheduleHoverUpdate(candles[index]);
    draw();
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  function handleMouseLeave() {
    dragRef.current = null;
    crosshairRef.current = null;
    scheduleHoverUpdate(null);
    draw();
  }

  function handleDoubleClick() {
    if (candles.length === 0) return;
    viewportRef.current = fitToData(candles);
    draw();
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!resolution.supported) {
    return (
      <StateMessage
        primary={`Chart visualization is unavailable for ${resolution.displaySymbol}.`}
        secondary={resolution.reason}
      />
    );
  }

  if (result.status === "loading") {
    return <StateMessage primary="Loading chart data…" />;
  }
  if (result.status === "unsupported") {
    return <StateMessage primary="Native chart data is unavailable for this instrument." secondary={result.message} />;
  }
  if (result.status === "error") {
    return <StateMessage primary="Chart data is temporarily unavailable." secondary={result.message} />;
  }
  if (result.status === "empty") {
    return <StateMessage primary="No candle data is available yet for this symbol and timeframe." />;
  }

  const trend = hoveredCandle ? classifyCandle(hoveredCandle) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartTimeframeSelector value={timeframe} onChange={setTimeframe} />
        {hoveredCandle ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={FIN_LABEL}>{formatTimestamp(hoveredCandle.time, "datetime")}</span>
            <OhlcField label="O" value={hoveredCandle.open} />
            <OhlcField label="H" value={hoveredCandle.high} />
            <OhlcField label="L" value={hoveredCandle.low} />
            <span className={`${FIN_PRIMARY} ${trend ? financialDirectionClass(trend === "bullish" ? "up" : trend === "bearish" ? "down" : "neutral") : ""}`}>
              C {formatPrice(hoveredCandle.close, { maxDecimals: 5 })}
            </span>
          </div>
        ) : (
          <span className={FIN_LABEL}>Native chart (beta)</span>
        )}
      </div>
      <div ref={containerRef} className="relative h-[320px] w-full sm:h-[420px] lg:h-[500px]">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />
      </div>
      {result.series && result.series.rejectedCount > 0 && (
        <p className="text-xs text-text-3">
          {result.series.rejectedCount} candle{result.series.rejectedCount === 1 ? "" : "s"} were excluded for failing data-integrity checks.
        </p>
      )}
    </div>
  );
}

function OhlcField({ label, value }: { label: string; value: number }) {
  return (
    <span className={FIN_SECONDARY}>
      {label} {formatPrice(value, { maxDecimals: 5 })}
    </span>
  );
}

function StateMessage({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="flex h-[320px] w-full flex-col items-center justify-center gap-1.5 rounded-panel border border-border bg-ink-2 px-4 text-center sm:h-[420px] lg:h-[500px]">
      <p className="text-sm text-text-2">{primary}</p>
      {secondary && <p className="text-xs text-text-3">{secondary}</p>}
    </div>
  );
}
