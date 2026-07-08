// components/trading/RiskCard.tsx
import type { RiskAnalysis } from "@/types/risk-analysis";

const QUALITY: Record<RiskAnalysis["tradeQuality"], string> = {
  low: "text-red-400",
  medium: "text-amber-400",
  high: "text-emerald-400",
  premium: "text-indigo-400",
};

export default function RiskCard({ risk }: { risk: RiskAnalysis }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Risk</p>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Risk %</span><span className="text-slate-200">{risk.riskPercent}%</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Risk/Reward</span><span className="text-slate-200">{risk.riskRewardRatio}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Suggested Lot</span><span className="text-slate-200">{risk.suggestedLotSize}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Quality</span><span className={`font-semibold capitalize ${QUALITY[risk.tradeQuality]}`}>{risk.tradeQuality}</span></div>
      </div>
    </div>
  );
}