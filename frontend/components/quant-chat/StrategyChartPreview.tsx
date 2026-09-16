"use client";

// components/quant-chat/StrategyChartPreview.tsx
// QP-3 - Strategy + Chart Preview. A deliberately lightweight, standalone
// chart: real candles + price axis + the compiled strategy's own indicator
// overlays - nothing else. This is a visual representation of the
// compiled strategy (which instrument/timeframe/indicators it references),
// NOT a backtest result - no trade markers, no entry/exit simulation, no
// equity curve, no performance claim of any kind.
//
// Reuses the SAME chart engine every other chart on this platform uses -
// fitToData()/resolveChartColors() (viewport/theme primitives) and
// renderChart() (the ONE canvas renderer, lib/chart-engine/renderer.ts) -
// never a second rendering engine. It is NOT a wrapper around
// NativeChart.tsx: NativeChart reads WorkspaceContext internally (for its
// own AlgoTestPanel/PaperTradingPanel sub-panel gating) and unconditionally
// mounts those two panels plus a full toolbar/drawing-tools/pointer-
// interaction surface, none of which this preview needs or should show.
//
// Purely presentational: candles/indicatorSeries/activePanels arrive as
// plain, already-resolved props (assembled server-side by
// services/algo-test/quant-chat-preview.service.ts, which fetches real
// bars and calls the compiler's own buildIndicatorSeries() over them) -
// this component fetches nothing itself. No WorkspaceContext, no
// AlgoTestPanel, no PaperTradingPanel, no drawing tools, no crosshair, no
// pan/zoom interaction (a static, read-only preview).
import { useEffect, useMemo, useRef } from "react";
import { renderChart } from "@/lib/chart-engine/renderer";
import { fitToData } from "@/lib/chart-engine/viewport";
import { resolveChartColors } from "@/lib/chart-engine/canvas-colors";
import type { ChartCandle } from "@/types/chart-data";
import type { IndicatorSeries, ChartPanelId } from "@/lib/chart-engine/indicators/types";
import type { SignalTimeframe } from "@/types/signal";

// Mirrors NativeChart.tsx's own PRICE_AXIS_WIDTH/TIME_AXIS_HEIGHT literals
// (local, unexported constants there) so this preview's axis gutters match
// the platform's one chart engine visually - not a second layout system,
// just the same two pixel values, since NativeChart.tsx itself is locked
// (must not be modified this sprint to export them).
const PRICE_AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 22;

export interface StrategyChartPreviewProps {
  symbol: string;
  timeframe: SignalTimeframe;
  name?: string;
  candles: readonly ChartCandle[];
  indicatorSeries: readonly IndicatorSeries[];
  activePanels: readonly ChartPanelId[];
}

export default function StrategyChartPreview({ symbol, timeframe, name, candles, indicatorSeries, activePanels }: StrategyChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimsRef = useRef({ width: 0, height: 0 });

  const viewport = useMemo(() => (candles.length > 0 ? fitToData(candles as ChartCandle[]) : null), [candles]);

  const draw = useMemo(
    () => () => {
      const canvas = canvasRef.current;
      if (!canvas || !viewport) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = dimsRef.current;
      if (width <= 0 || height <= 0) return;

      renderChart({
        ctx,
        dims: { width, height, priceAxisWidth: PRICE_AXIS_WIDTH, timeAxisHeight: TIME_AXIS_HEIGHT },
        candles: candles as ChartCandle[],
        viewport,
        timeframe,
        colors: resolveChartColors("mt5"),
        activePanels: [...activePanels],
        indicatorSeries: [...indicatorSeries],
        symbolLabel: `${symbol}, ${timeframe.toUpperCase()}: ${name ?? symbol}`,
      });
    },
    [candles, viewport, timeframe, activePanels, indicatorSeries, symbol, name],
  );

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

  useEffect(() => {
    draw();
  }, [draw]);

  if (candles.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-border bg-ink p-4 text-center text-xs text-text-3">Chart preview is not available for this instrument right now.</div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-border bg-ink p-3">
      <p className="mb-2 text-[11px] text-text-3">
        This is a strategy preview based on the selected instrument, timeframe, and referenced indicators. It is not a backtest result.
      </p>
      <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-lg">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
    </div>
  );
}
