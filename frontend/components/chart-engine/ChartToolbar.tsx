"use client";

// components/chart-engine/ChartToolbar.tsx
// Sprint D2.7.3, Phase 10 - the professional AT24 chart header: symbol,
// timeframe (reusing the existing ChartTimeframeSelector/SIGNAL_TIMEFRAMES
// - never a second timeframe union), an Indicators menu driven entirely by
// panel-registry.ts's DEFAULT_INDICATOR_CONFIGS (never a hardcoded list
// duplicated here), Fit, and Live/Go-to-latest.
import { useState } from "react";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import type { SignalTimeframe } from "@/types/signal";
import ChartTimeframeSelector from "./ChartTimeframeSelector";

export interface ChartToolbarProps {
  displaySymbol: string;
  timeframe: SignalTimeframe;
  onTimeframeChange: (timeframe: SignalTimeframe) => void;
  activeIndicatorKeys: ReadonlySet<string>;
  onToggleIndicator: (key: string) => void;
  onFit: () => void;
  onGoLive: () => void;
  isLive: boolean;
}

export default function ChartToolbar({
  displaySymbol,
  timeframe,
  onTimeframeChange,
  activeIndicatorKeys,
  onToggleIndicator,
  onFit,
  onGoLive,
  isLive,
}: ChartToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${FIN_LABEL} rounded-control border border-border bg-ink-3 px-2 py-1`}>{displaySymbol}</span>
      <ChartTimeframeSelector value={timeframe} onChange={onTimeframeChange} />

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
        >
          Indicators{activeIndicatorKeys.size > 0 ? ` (${activeIndicatorKeys.size})` : ""}
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full z-10 mt-1 w-48 rounded-panel border border-border bg-ink-2 p-1.5 shadow-raised"
          >
            {DEFAULT_INDICATOR_CONFIGS.map((cfg) => (
              <label
                key={cfg.key}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs text-text-2 hover:bg-ink-3"
              >
                <input
                  type="checkbox"
                  checked={activeIndicatorKeys.has(cfg.key)}
                  onChange={() => onToggleIndicator(cfg.key)}
                  className="accent-gold"
                />
                {cfg.key.toUpperCase()}
              </label>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onFit}
        className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
      >
        Fit
      </button>

      <button
        type="button"
        onClick={onGoLive}
        aria-pressed={isLive}
        className={`rounded-control border px-2.5 py-1 text-[11px] font-medium transition ${
          isLive ? "border-signal-up/40 bg-signal-up/10 text-signal-up" : "border-border bg-ink-3 text-text-3 hover:bg-ink-4 hover:text-text"
        }`}
      >
        {isLive ? "● Live" : "Go to latest"}
      </button>
    </div>
  );
}
