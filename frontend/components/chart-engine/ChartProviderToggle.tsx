"use client";

// components/chart-engine/ChartProviderToggle.tsx
// Sprint D2.7.2, Phase 13 - the explicit ChartProvider boundary the sprint
// brief requires: the Workspace lets the user pick which visualization
// renders, "native" or "tradingview" - neither is a silent fallback for
// the other (see ChartPanel.tsx, the only place this choice is consumed).
//
// Sprint D2.9.6 - Native is no longer "(Beta)": the D2.9.1-D2.9.5 hardening
// pass (light theme, cross-pane crosshair sync, mobile verification, trade
// clustering, equity overlay) closed the gaps that label was tracking, and
// ChartPanel.tsx's own default flipped to "native" in the same sprint.
// TradingView keeps its plain label - it's the explicit fallback now, not
// mislabeled as anything else; it never needed a qualifier to begin with.
import type { ChartProviderKind } from "@/types/chart-data";

const OPTIONS: { value: ChartProviderKind; label: string }[] = [
  { value: "tradingview", label: "TradingView" },
  { value: "native", label: "Native" },
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
