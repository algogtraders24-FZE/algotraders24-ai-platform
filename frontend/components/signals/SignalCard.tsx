// components/signals/SignalCard.tsx
import type { Signal } from "@/types/signal";
import ConfidenceBadge from "./ConfidenceBadge";
import RiskBadge from "./RiskBadge";

const DIR: Record<Signal["direction"], string> = {
  BUY: "text-success",
  SELL: "text-danger",
  WAIT: "text-text-2",
};

export default function SignalCard({ signal }: { signal: Signal }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4 transition hover:border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text">{signal.symbol}</p>
          <p className="text-xs text-text-3 capitalize">{signal.category} · {signal.timeframe}</p>
        </div>
        <span className={`text-sm font-bold ${DIR[signal.direction]}`}>{signal.direction}</span>
      </div>

      <p className="mt-3 text-xs text-text-2 line-clamp-2">{signal.rationale}</p>

      <div className="mt-4 flex items-center gap-2">
        <ConfidenceBadge score={signal.confidence} />
        <RiskBadge level={signal.riskLevel} />
        <span className="ml-auto text-xs text-text-3 capitalize">{signal.status}</span>
      </div>
    </div>
  );
}