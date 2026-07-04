// components/signals/SignalCard.tsx
import type { Signal } from "@/types/signal";
import ConfidenceBadge from "./ConfidenceBadge";
import RiskBadge from "./RiskBadge";

const DIR: Record<Signal["direction"], string> = {
  BUY: "text-emerald-400",
  SELL: "text-red-400",
  WAIT: "text-slate-400",
};

export default function SignalCard({ signal }: { signal: Signal }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100">{signal.symbol}</p>
          <p className="text-xs text-slate-500 capitalize">{signal.category} · {signal.timeframe}</p>
        </div>
        <span className={`text-sm font-bold ${DIR[signal.direction]}`}>{signal.direction}</span>
      </div>

      <p className="mt-3 text-xs text-slate-400 line-clamp-2">{signal.rationale}</p>

      <div className="mt-4 flex items-center gap-2">
        <ConfidenceBadge score={signal.confidence} />
        <RiskBadge level={signal.riskLevel} />
        <span className="ml-auto text-xs text-slate-500 capitalize">{signal.status}</span>
      </div>
    </div>
  );
}