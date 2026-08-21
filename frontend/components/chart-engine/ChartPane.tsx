"use client";

// components/chart-engine/ChartPane.tsx
// Sprint D2.7.11 Phase 3 - one grid cell of the multi-symbol tiled layout:
// a compact per-pane header (independent instrument search + "set as
// primary" control) above one NativeChart instance. Deliberately a thin
// wrapper, not a second copy of chart state - every field it renders is a
// controlled prop owned by ChartPanel (the same "lift state to the one
// place that outlives a remount" rule D2.7.4 already established for
// timeframe/indicators, just extended to symbol and to N panes instead of
// one). The header is only rendered when there's more than one visible
// pane (`showControls`) - with a single pane, NativeChart's own
// ChartHeader/ChartToolbar already show the symbol; a second, redundant
// search box above a lone chart would just be clutter.
import { getMarket } from "@/lib/market-data/market-registry";
import InstrumentSearchBox from "@/components/workspace/InstrumentSearchBox";
import NativeChart from "./NativeChart";
import type { SignalTimeframe } from "@/types/signal";

export interface ChartPaneState {
  id: string;
  symbol: string;
  timeframe: SignalTimeframe;
  activeIndicatorKeys: Set<string>;
}

export interface ChartPaneProps {
  pane: ChartPaneState;
  isPrimary: boolean;
  showControls: boolean;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: SignalTimeframe) => void;
  onToggleIndicator: (key: string) => void;
  onApplyIndicatorKeys: (keys: readonly string[]) => void;
  onSetPrimary: () => void;
}

export default function ChartPane({ pane, isPrimary, showControls, onSymbolChange, onTimeframeChange, onToggleIndicator, onApplyIndicatorKeys, onSetPrimary }: ChartPaneProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${showControls ? "rounded-panel border p-2" : ""} ${showControls && isPrimary ? "border-gold/50" : showControls ? "border-border" : ""}`}>
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InstrumentSearchBox value={pane.symbol} onChange={onSymbolChange} compact />
          <button
            type="button"
            onClick={onSetPrimary}
            aria-pressed={isPrimary}
            title={isPrimary ? "This pane drives the rest of the workspace (AI Intelligence, Assistant, Research)" : "Make this pane drive the rest of the workspace"}
            className={`rounded-control border px-2 py-1 text-[11px] font-medium transition ${
              isPrimary ? "border-gold/40 bg-gold/10 text-gold" : "border-border bg-ink-3 text-text-3 hover:bg-ink-4 hover:text-text"
            }`}
          >
            {isPrimary ? "★ Primary" : "☆ Set primary"}
          </button>
        </div>
      )}
      <NativeChart
        symbol={pane.symbol}
        name={getMarket(pane.symbol)?.name}
        timeframe={pane.timeframe}
        onTimeframeChange={onTimeframeChange}
        activeIndicatorKeys={pane.activeIndicatorKeys}
        onToggleIndicator={onToggleIndicator}
        onApplyIndicatorKeys={onApplyIndicatorKeys}
      />
    </div>
  );
}
