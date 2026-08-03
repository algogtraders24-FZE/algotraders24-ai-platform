"use client";

// components/workspace/tradingview/AdvancedChart.tsx
// Sprint D2.3 (Phase 5) - the workspace's TradingView Advanced Chart, bound to
// the shared workspace symbol. It is a SUPPORTING visualization only: it sits
// above the AI Intelligence panel in the hierarchy, and symbol changes are
// driven by the workspace's Global Symbol Selector (allow_symbol_change is off)
// so the chart never becomes a second, competing source of truth. Themed to
// Design System D1.1 (ink background, steel grid). Remounts via `key` when the
// symbol changes so the wrapper re-injects cleanly.
import { useWorkspace } from "@/context/WorkspaceContext";
import TradingViewWidget from "./TradingViewWidget";

const ADVANCED_CHART_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

// Canonical platform symbol -> TradingView symbol. Only the enabled markets are
// mapped; an unmapped symbol falls back to EUR/USD rather than rendering a
// broken chart.
const TV_SYMBOL: Record<string, string> = {
  EURUSD: "FX:EURUSD",
  GBPUSD: "FX:GBPUSD",
  USDJPY: "FX:USDJPY",
  XAUUSD: "OANDA:XAUUSD",
  XAGUSD: "OANDA:XAGUSD",
  BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD",
};

export default function AdvancedChart() {
  const { symbol } = useWorkspace();
  const tvSymbol = TV_SYMBOL[symbol] ?? "FX:EURUSD";

  const config = {
    autosize: true,
    symbol: tvSymbol,
    interval: "D",
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

  return <TradingViewWidget key={tvSymbol} scriptSrc={ADVANCED_CHART_SRC} config={config} height={420} />;
}
