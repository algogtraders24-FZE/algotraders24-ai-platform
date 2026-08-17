"use client";

// components/chart-engine/MicrostructurePanel.tsx
// Sprint D2.8.10 - Microstructure Visualization & Intelligence Evidence
// Layer. A pure presentation component over an already-fetched
// MicrostructureSnapshot (via useMicrostructureSnapshot) - it computes
// nothing itself, matching ChartHeader.tsx's own established discipline
// ("this component does zero fetching/calculation of its own"). Every
// field renders either the real value or its honest CapabilityState word -
// never a fabricated number for an unavailable/invalid/not_supported_by_provider
// field, and never silently upgrading stale to fresh (same rule
// lib/microstructure/microstructure-presentation.ts already enforces for
// the AI presentation path - this is that same rule's UI equivalent, not a
// second implementation of it).
import { formatPrice, formatPercent, formatCompactVolume, formatTimestamp } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY } from "@/components/ui/financial-typography";
import StatField from "@/components/workspace/StatField";
import { formatMicrostructureFieldForUI as fieldText } from "@/lib/microstructure/microstructure-panel-format";
import { useMicrostructureSnapshot } from "./useMicrostructureSnapshot";

export interface MicrostructurePanelProps {
  symbol: string;
}

export default function MicrostructurePanel({ symbol }: MicrostructurePanelProps) {
  const result = useMicrostructureSnapshot(symbol);

  if (result.status === "loading") {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2">
        <span className={FIN_LABEL}>Loading microstructure evidence…</span>
      </div>
    );
  }

  if (result.status === "unsupported") {
    return (
      <div className="rounded-control border border-dashed border-border bg-ink-3 px-3 py-2">
        <p className={FIN_LABEL}>Microstructure</p>
        <p className={`${FIN_TERTIARY} mt-0.5`}>
          Provider: Not available · Order Book: Not supported for this instrument · Volume Delta: Not available
        </p>
      </div>
    );
  }

  if (result.status === "error" || !result.snapshot) {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2">
        <p className={FIN_LABEL}>Microstructure</p>
        <p className={`${FIN_TERTIARY} mt-0.5`}>{result.message ?? "Evidence is temporarily unavailable."}</p>
      </div>
    );
  }

  const snapshot = result.snapshot;
  const stale = snapshot.freshnessStatus === "stale";

  return (
    <div className="rounded-control border border-border bg-ink-3 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={FIN_LABEL}>
          {snapshot.provider === "binance" ? "Binance Order-Book Evidence" : `${snapshot.provider} Venue Microstructure`}
        </p>
        <p className={FIN_TERTIARY}>
          {snapshot.symbol} · {stale ? <span className="text-warn">Stale</span> : snapshot.freshnessStatus === "fresh" ? <span className="text-signal-up">Live</span> : snapshot.freshnessStatus} · Updated{" "}
          {formatTimestamp(Date.parse(snapshot.timestamp), "time")}
        </p>
      </div>
      <p className={`${FIN_TERTIARY} mt-0.5`}>
        Source: {snapshot.provider} · Data: Live REST snapshot · Venue-specific evidence, not global market liquidity
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatField label="Bid">
          <span className={FIN_PRIMARY}>{fieldText(snapshot.evidence.bid, (v) => formatPrice(v, { maxDecimals: 5 }))}</span>
        </StatField>
        <StatField label="Ask">
          <span className={FIN_PRIMARY}>{fieldText(snapshot.evidence.ask, (v) => formatPrice(v, { maxDecimals: 5 }))}</span>
        </StatField>
        <StatField label="Spread">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.spread, (v) => formatPrice(v, { maxDecimals: 5 }))}</span>
        </StatField>
        <StatField label="Bid Depth">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.bidDepth, (v) => formatCompactVolume(v))}</span>
        </StatField>
        <StatField label="Ask Depth">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.askDepth, (v) => formatCompactVolume(v))}</span>
        </StatField>
        <StatField label="Imbalance">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.depthImbalance, (v) => formatPercent(v * 100, { decimals: 1 }))}</span>
        </StatField>
        <StatField label="Buy Volume">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.buyVolume, (v) => formatCompactVolume(v))}</span>
        </StatField>
        <StatField label="Sell Volume">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.sellVolume, (v) => formatCompactVolume(v))}</span>
        </StatField>
        <StatField label="Volume Delta">
          <span className={FIN_SECONDARY}>{fieldText(snapshot.derived.volumeDelta, (v) => formatCompactVolume(v))}</span>
        </StatField>
      </div>
    </div>
  );
}
