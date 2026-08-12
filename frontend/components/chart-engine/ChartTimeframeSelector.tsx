"use client";

// components/chart-engine/ChartTimeframeSelector.tsx
// Sprint D2.7.2, Phase 10 - a small control over the EXISTING SignalTimeframe
// union (types/signal.ts) - never a chart-only timeframe list. Display
// labels are presentation-only; the value passed to onChange/the candles
// route is always a real SignalTimeframe.
import { SIGNAL_TIMEFRAMES, type SignalTimeframe } from "@/types/signal";

const LABELS: Record<SignalTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

export interface ChartTimeframeSelectorProps {
  value: SignalTimeframe;
  onChange: (timeframe: SignalTimeframe) => void;
}

export default function ChartTimeframeSelector({ value, onChange }: ChartTimeframeSelectorProps) {
  return (
    <div role="group" aria-label="Chart timeframe" className="flex items-center gap-0.5 rounded-control border border-border bg-ink-3 p-0.5">
      {SIGNAL_TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          aria-pressed={value === tf}
          className={`rounded-[4px] px-2 py-1 text-[11px] font-medium transition ${
            value === tf ? "bg-gold text-ink" : "text-text-3 hover:bg-ink-4 hover:text-text"
          }`}
        >
          {LABELS[tf]}
        </button>
      ))}
    </div>
  );
}
