// components/signals/RegimeOverviewCard.tsx
// Sprint D2.8.16 - the reframed "AI Signals" page's card. Deliberately has
// no direction (BUY/SELL/WAIT), no entry/stopLoss/takeProfit, and no
// confidence framed as a win probability - see the sprint report and
// types/market-regime-overview.ts for why. Reuses the exact same
// regime/decision-state tone helpers the Workspace Research panel already
// uses (components/intelligence-workspace/format.ts), so a "Trending
// Bullish" badge here means the identical thing it means there.
import Badge from "@/components/ui/Badge";
import RiskBadge from "./RiskBadge";
import { formatLabel, regimeTone, DECISION_STATE_TONE } from "@/components/intelligence-workspace/format";
import { formatScore } from "@/lib/financial-format";
import type { MarketRegimeOverviewItem } from "@/types/market-regime-overview";

export default function RegimeOverviewCard({ item }: { item: MarketRegimeOverviewItem }) {
  if (item.status !== "resolved") {
    return (
      <div className="rounded-xl border border-border bg-ink-2 p-4">
        <p className="text-sm font-semibold text-text">{item.symbol}</p>
        <p className="mt-1 text-xs text-text-3">{item.name}</p>
        <p className="mt-3 text-xs text-text-3">
          {item.status === "insufficient-data"
            ? "No verified intelligence available right now - shown honestly rather than fabricated."
            : "Could not resolve this instrument right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">{item.symbol}</p>
          <p className="text-xs text-text-3">{item.name}</p>
        </div>
        {item.regimeType && <Badge tone={regimeTone(item.regimeType)}>{formatLabel(item.regimeType)}</Badge>}
      </div>

      {item.basis && <p className="mt-3 text-xs text-text-2 line-clamp-2">{item.basis}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {item.decisionState && <Badge tone={DECISION_STATE_TONE[item.decisionState]}>{formatLabel(item.decisionState)}</Badge>}
        {item.riskLevel && <RiskBadge level={item.riskLevel} />}
        <span className="ml-auto text-xs text-text-3">
          Intelligence <span className="font-mono text-text-2">{formatScore(item.intelligenceScore)}</span>
        </span>
      </div>
    </div>
  );
}
