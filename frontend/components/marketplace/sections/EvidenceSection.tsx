// components/marketplace/sections/EvidenceSection.tsx
// Sprint M8 - Displays ONLY AT24-computed evidence (M8 brief section 10).
// Seller-entered metrics never populate this component - there is no prop
// path from seller-authored fields into EvidenceSummary at all, by
// construction (see types/marketplace.ts).
import type { EvidenceSummary } from "@/types/marketplace";

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-xl bg-ink-2 border border-border p-4">
      <div className="text-text-3 text-xs">{label}</div>
      <div className="font-semibold mt-1 text-sm">{value ?? "—"}</div>
    </div>
  );
}

export default function EvidenceSection({ evidence }: { evidence: EvidenceSummary | null }) {
  return (
    <section aria-labelledby="evidence-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="evidence-heading" className="text-xl font-bold mb-1">
        Evidence
      </h2>
      <p className="text-xs text-text-3 mb-4">AT24-computed only. Never seller-entered.</p>

      {evidence ? (
        <div className="grid sm:grid-cols-3 gap-3">
          <Stat label="Trade Count" value={evidence.tradeCount} />
          <Stat label="Instrument" value={evidence.symbol} />
          <Stat label="Timeframe" value={evidence.timeframe} />
          <Stat label="Test Period" value={evidence.periodStart && evidence.periodEnd ? `${evidence.periodStart} – ${evidence.periodEnd}` : null} />
          <Stat label="Net Result" value={evidence.netProfit} />
          <Stat label="Profit Factor" value={evidence.profitFactor} />
          <Stat label="Max Drawdown" value={evidence.maxDrawdownPercent != null ? `${(evidence.maxDrawdownPercent * 100).toFixed(2)}%` : null} />
          <Stat label="Win Rate" value={evidence.winRate != null ? `${(evidence.winRate * 100).toFixed(1)}%` : null} />
          <Stat label="Total Cost" value={evidence.totalCost} />
          <Stat label="Data Source" value={evidence.dataSource} />
          <Stat label="Broker" value={evidence.broker} />
          <Stat label="Generator" value={evidence.generator} />
        </div>
      ) : (
        <p className="text-sm text-text-3">
          No AT24-verified Evidence is attached to this listing yet. Evidence unavailable — nothing below this line is a
          performance claim.
        </p>
      )}
    </section>
  );
}
