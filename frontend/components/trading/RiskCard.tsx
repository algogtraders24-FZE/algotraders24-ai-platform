// components/trading/RiskCard.tsx
import type { RiskAnalysis } from "@/types/risk-analysis";

const QUALITY: Record<RiskAnalysis["tradeQuality"], string> = {
  low: "text-danger",
  medium: "text-warning",
  high: "text-success",
  premium: "text-gold",
};

export default function RiskCard({ risk }: { risk: RiskAnalysis }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Risk</p>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-text-3">Risk %</span><span className="text-text">{risk.riskPercent}%</span></div>
        <div className="flex justify-between"><span className="text-text-3">Risk/Reward</span><span className="text-text">{risk.riskRewardRatio}</span></div>
        <div className="flex justify-between"><span className="text-text-3">Suggested Lot</span><span className="text-text">{risk.suggestedLotSize}</span></div>
        <div className="flex justify-between"><span className="text-text-3">Quality</span><span className={`font-semibold capitalize ${QUALITY[risk.tradeQuality]}`}>{risk.tradeQuality}</span></div>
      </div>
    </div>
  );
}