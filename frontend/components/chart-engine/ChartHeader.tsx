"use client";

// components/chart-engine/ChartHeader.tsx
// Sprint D2.7.5, Phase 2 - the professional chart header: canonical
// instrument name, symbol, active timeframe, current price, a real range
// change, data freshness, provider provenance, and the active chart engine
// - all sourced from props NativeChart already has (WorkspaceContext's
// `name`, the `timeframe` prop, and the already-fetched `ChartSeries`).
// This component does zero fetching of its own - it is a pure presentation
// layer over data the caller already loaded, per the sprint's own explicit
// "do not duplicate market-data fetching" instruction. Every value is real:
// no field renders a fabricated price/change/freshness when the
// corresponding source data is genuinely absent - it renders an honest "—"
// instead (same discipline as WorkspaceHeader/MarketRibbon).
import { formatPrice, formatPercent, formatDuration } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY, financialDirectionClass } from "@/components/ui/financial-typography";
import { computeRangeChange } from "@/lib/chart-engine/range-change";
import { TIMEFRAME_LABELS } from "./ChartTimeframeSelector";
import type { ChartSeries } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";

export interface ChartHeaderProps {
  displaySymbol: string;
  instrumentName?: string;
  timeframe: SignalTimeframe;
  series?: ChartSeries;
}

const FRESHNESS_LABEL: Record<string, string> = {
  fresh: "Live",
  stale: "Stale",
  unknown: "Unknown",
};

export default function ChartHeader({ displaySymbol, instrumentName, timeframe, series }: ChartHeaderProps) {
  const candles = series?.candles ?? [];
  const latest = candles[candles.length - 1];
  // Sprint D2.7.5 - a "range change" (first loaded candle's open -> latest
  // candle's close), deliberately labeled as such rather than "today" or
  // "24h" - this series carries no session/day boundary, so any other label
  // would imply a figure this data doesn't actually support.
  const rangeChange = computeRangeChange(candles);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control border border-border bg-ink-3 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-display text-base font-semibold text-text">{displaySymbol}</span>
        {instrumentName && <span className={FIN_TERTIARY}>{instrumentName}</span>}
        <span className={`${FIN_LABEL} rounded-control border border-border bg-ink-4 px-1.5 py-0.5`}>{TIMEFRAME_LABELS[timeframe]}</span>
        <span className={FIN_LABEL}>Native Engine</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {latest ? (
          <span className={`${FIN_PRIMARY} text-sm`}>{formatPrice(latest.close, { maxDecimals: 5 })}</span>
        ) : (
          <span className={FIN_TERTIARY}>—</span>
        )}
        {rangeChange && (
          <span className={`${FIN_SECONDARY} text-xs ${financialDirectionClass(rangeChange.direction)}`}>
            {formatPercent(rangeChange.changePercent)} <span className={FIN_TERTIARY}>(range)</span>
          </span>
        )}
        {series?.freshness && (
          <span className={`${FIN_LABEL} ${series.freshness === "stale" ? "text-warn" : series.freshness === "fresh" ? "text-signal-up" : ""}`}>
            {FRESHNESS_LABEL[series.freshness] ?? series.freshness}
          </span>
        )}
        {series?.provider && (
          <span className={FIN_TERTIARY}>
            {series.provider}
            {series.fallbackUsed ? " (fallback)" : ""}
            {series.cached ? ` · cached ${formatDuration(series.cacheAgeMs ?? 0)} ago` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
