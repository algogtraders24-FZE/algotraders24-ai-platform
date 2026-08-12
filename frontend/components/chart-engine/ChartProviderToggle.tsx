"use client";

// components/chart-engine/ChartProviderToggle.tsx
// Sprint D2.7.2, Phase 13 - the explicit ChartProvider boundary the sprint
// brief requires: the Workspace lets the user pick which visualization
// renders, "native" or "tradingview" - neither is a silent fallback for
// the other (see ChartPanel.tsx, the only place this choice is consumed).
import type { ChartProviderKind } from "@/types/chart-data";

const OPTIONS: { value: ChartProviderKind; label: string }[] = [
  { value: "tradingview", label: "TradingView" },
  { value: "native", label: "Native (Beta)" },
];

export interface ChartProviderToggleProps {
  value: ChartProviderKind;
  onChange: (provider: ChartProviderKind) => void;
}

export default function ChartProviderToggle({ value, onChange }: ChartProviderToggleProps) {
  return (
    <div role="group" aria-label="Chart engine" className="flex items-center gap-0.5 rounded-control border border-border bg-ink-3 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition ${
            value === opt.value ? "bg-gold text-ink" : "text-text-3 hover:bg-ink-4 hover:text-text"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
