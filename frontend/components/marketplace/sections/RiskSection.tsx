// components/marketplace/sections/RiskSection.tsx
// Sprint M8 - Displays M5 outputs verbatim (M8 brief section 12). If
// status is PARTIAL, this renders "PARTIAL" - it is never silently
// converted into a positive or negative badge.
import Badge from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type { RiskSummary } from "@/types/marketplace";

const STATUS_TONE: Record<string, BadgeTone> = {
  COMPLETE: "success",
  PARTIAL: "warning",
  INCONCLUSIVE: "neutral",
  FAILED: "danger",
};

const DATA_QUALITY_TONE: Record<string, BadgeTone> = {
  AVAILABLE: "success",
  LIMITED: "warning",
  UNAVAILABLE: "neutral",
  INCONCLUSIVE: "neutral",
};

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-xl bg-ink-2 border border-border p-4">
      <div className="text-text-3 text-xs">{label}</div>
      <div className="font-semibold mt-1 text-sm">{value ?? "—"}</div>
    </div>
  );
}

export default function RiskSection({ risk }: { risk: RiskSummary | null }) {
  return (
    <section aria-labelledby="risk-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="risk-heading" className="text-xl font-bold mb-1">
        Risk Analysis
      </h2>
      {risk ? (
        <>
          <p className="text-xs text-text-3 mb-4">
            Status: <Badge tone={STATUS_TONE[risk.status] ?? "neutral"}>{risk.status}</Badge>
          </p>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <Stat label="Max Drawdown" value={risk.maxDrawdownPercent != null ? `${(risk.maxDrawdownPercent * 100).toFixed(2)}%` : null} />
            <Stat label="Max Consecutive Losses" value={risk.maxConsecutiveLosses} />
            <Stat label="Loss Clustering" value={risk.lossClusteredSharePct != null ? `${(risk.lossClusteredSharePct * 100).toFixed(1)}%` : null} />
            <Stat label="Recovery Episodes" value={risk.recoveryEpisodes} />
            <Stat label="Expectancy / Trade" value={risk.expectancyPerTrade} />
            <Stat label="Profit Factor" value={risk.profitFactor} />
            <Stat label="Total Cost" value={risk.totalCost} />
            <Stat label="Max Simultaneous Positions" value={risk.maxSimultaneousPositions} />
          </div>
          {Object.keys(risk.dataQuality).length > 0 && (
            <div>
              <p className="text-xs text-text-3 mb-2">Data quality by dimension:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(risk.dataQuality).map(([dim, quality]) => (
                  <Badge key={dim} tone={DATA_QUALITY_TONE[quality] ?? "neutral"}>
                    {dim}: {quality}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-text-3">No AT24 risk analysis has been run for this listing yet. Risk analysis unavailable.</p>
      )}
    </section>
  );
}
