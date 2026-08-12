"use client";

// components/workspace/tradingview/AdvancedChart.tsx
// Sprint D2.3 (Phase 5) - the workspace's TradingView Advanced Chart, bound to
// the shared workspace symbol. It is a SUPPORTING visualization only: it sits
// above the AI Intelligence panel in the hierarchy, and symbol changes are
// driven by the workspace's Global Symbol Selector (allow_symbol_change is off)
// so the chart never becomes a second, competing source of truth. Themed to
// Design System D1.1 (ink background, steel grid). Remounts via `key` when the
// symbol changes so the wrapper re-injects cleanly.
//
// Height is responsive: ~320px on mobile, ~420px on tablet, ~500px on desktop
// (comfortable viewing without letting the chart out-grow its supporting
// role — the AI Intelligence panel stays the visually dominant element right
// below it). CHART_RESERVE_HEIGHT is CHART_HEIGHT plus room for the required
// TradingView attribution line, so the pre-mount placeholder and the mounted
// widget are the same height at every breakpoint (no layout shift).
//
// Sprint D2.3 (Phase 7) - the widget's own display interval comes from the
// active Workspace Profile (WorkspaceContext.chartInterval, see
// PROFILE_INTERVAL in types/workspace-preferences.ts). This is a TradingView
// widget-config value only - it is never sent to the AI Intelligence
// pipeline, which has no timeframe parameter to personalize.
//
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. The chart's own local 7-entry symbol map
// (with a silent EUR/USD fallback for anything else) was the root cause of
// "a searched/selected symbol appears active but the chart doesn't render
// it" - it silently substituted a different instrument's chart instead of
// erroring. Replaced with lib/market-data/chart-instrument-resolver.ts, the
// ONE deterministic mapping layer covering every canonical instrument. An
// unsupported instrument now renders an explicit, honest state instead of a
// wrong chart. The `key` below still forces a full TradingViewWidget
// remount on every symbol/interval change (React reconciliation, not a
// timeout) - now driven by the resolved chart symbol so it's correct for
// every instrument, not just the previous 7.
import { useWorkspace } from "@/context/WorkspaceContext";
import { resolveChartInstrument } from "@/lib/market-data/chart-instrument-resolver";
import TradingViewWidget from "./TradingViewWidget";

const ADVANCED_CHART_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const CHART_HEIGHT = "h-[320px] sm:h-[420px] lg:h-[500px]";
const CHART_RESERVE_HEIGHT = "h-[348px] sm:h-[448px] lg:h-[528px]";

export default function AdvancedChart() {
  const { symbol, chartInterval } = useWorkspace();
  const resolution = resolveChartInstrument(symbol);

  if (!resolution.supported || !resolution.chartSymbol) {
    return (
      <div
        className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-panel border border-border bg-ink-2 px-4 text-center ${CHART_RESERVE_HEIGHT}`}
      >
        <p className="text-sm text-text-2">Chart visualization is unavailable for {resolution.displaySymbol}.</p>
        {resolution.reason && <p className="text-xs text-text-3">{resolution.reason}</p>}
      </div>
    );
  }

  const tvSymbol = resolution.chartSymbol;
  const config = {
    autosize: true,
    symbol: tvSymbol,
    interval: chartInterval,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    backgroundColor: "rgba(11,15,25,1)",
    gridColor: "rgba(148,163,184,0.12)",
    support_host: "https://www.tradingview.com",
  };

  return (
    <TradingViewWidget
      key={`${tvSymbol}:${chartInterval}`}
      scriptSrc={ADVANCED_CHART_SRC}
      config={config}
      heightClassName={CHART_HEIGHT}
      reserveClassName={CHART_RESERVE_HEIGHT}
    />
  );
}
