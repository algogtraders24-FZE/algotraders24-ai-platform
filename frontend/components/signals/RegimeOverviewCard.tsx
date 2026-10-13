// components/signals/RegimeOverviewCard.tsx
// The AI Signals page's card. Deliberately has no direction (BUY/SELL/WAIT), no
// entry/stopLoss/takeProfit, and no confidence framed as a win probability - see
// types/market-regime-overview.ts. Reuses the exact regime/decision-state tone
// helpers the Workspace Research panel uses (components/intelligence-workspace/
// format.ts), so a "Trending Bullish" badge here means what it means there.
//
// What differs per market, and so what the card leads with: the regime and its
// own confidence, and the Macro Alignment gauge (services/macro). What does NOT
// differ much per market, and is therefore labelled for what it is: the
// "Data quality" score (completeness of the data behind the reading, almost the
// same for every symbol) and the overall risk (the worst of eight categories,
// driven today by how few evidence types exist) - the card says what drives it.
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import RiskBadge from "./RiskBadge";
import { MiniGauge, LEAN_TEXT } from "@/components/macro/MiniGauge";
import { formatLabel, regimeTone, DECISION_STATE_TONE } from "@/components/intelligence-workspace/format";
import { formatScore } from "@/lib/financial-format";
import { plainRegime } from "@/services/automation/brief";
import type { MacroOverviewItem } from "@/services/macro/macro-overview";
import type { MarketRegimeOverviewItem } from "@/types/market-regime-overview";

interface Props {
  item: MarketRegimeOverviewItem;
  /** undefined = still loading, null = this asset has no macro profile / it could not be fetched. */
  macro?: MacroOverviewItem | null;
}

function MacroBlock({ macro }: { macro: Props["macro"] }) {
  if (macro === undefined) return <Skeleton className="mx-auto h-16 w-24" />;
  if (macro === null) return <p className="py-3 text-center text-xs text-text-3">Macro alignment not available for this market yet.</p>;
  return (
    <div className="space-y-1">
      <MiniGauge score={macro.score} lean={macro.lean} />
      <p className={`text-center text-sm font-semibold ${LEAN_TEXT[macro.lean]}`}>{macro.label}</p>
      <p className="text-center text-[11px] text-text-3">
        Macro alignment · {macro.availableDrivers}/{macro.totalDrivers} drivers
      </p>
    </div>
  );
}

export default function RegimeOverviewCard({ item, macro }: Props) {
  if (item.status !== "resolved") {
    return (
      <Card padding="sm">
        <p className="text-sm font-semibold text-text">{item.symbol}</p>
        <p className="mt-1 text-xs text-text-3">{item.name}</p>
        <p className="mt-3 text-xs text-text-3">
          {item.status === "insufficient-data"
            ? "No verified intelligence available right now - shown honestly rather than fabricated."
            : "Could not resolve this instrument right now."}
        </p>
        {macro ? (
          <div className="mt-3 border-t border-border pt-3">
            <MacroBlock macro={macro} />
          </div>
        ) : null}
      </Card>
    );
  }

  const plain = item.regimeType ? plainRegime(item.regimeType) : null;
  return (
    <Card padding="sm" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">{item.symbol}</p>
          <p className="text-xs text-text-3">{item.name}</p>
        </div>
        {item.regimeType && <Badge tone={regimeTone(item.regimeType)}>{formatLabel(item.regimeType)}</Badge>}
      </div>

      {plain && (
        <p className="text-sm text-text-2">
          Market is <span className="font-medium text-text">{plain}</span>
          {item.regimeConfidence !== undefined && <> · regime confidence <span className="font-mono text-text">{item.regimeConfidence}%</span></>}
        </p>
      )}

      <div className="border-t border-border pt-3">
        <MacroBlock macro={macro} />
      </div>

      <div className="space-y-1.5 border-t border-border pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {item.decisionState && <Badge tone={DECISION_STATE_TONE[item.decisionState]}>{formatLabel(item.decisionState)}</Badge>}
          {item.riskLevel && <RiskBadge level={item.riskLevel} />}
          <span className="ml-auto text-text-3" title="How complete the data behind this reading is - not market conviction and not a probability. It is close to the same for every market that has full data.">
            Data quality <span className="font-mono text-text-2">{formatScore(item.intelligenceScore)}</span>
          </span>
        </div>
        {item.riskDriver && item.riskDriver.reason && (
          <p className="text-text-3">
            Risk is {item.riskLevel}: {item.riskDriver.categories.join(", ")} - {item.riskDriver.reason}
          </p>
        )}
        {item.basis && <p className="line-clamp-2 text-text-3">{item.basis}</p>}
      </div>
    </Card>
  );
}
