// components/signals/SignalTable.tsx
import type { Signal } from "@/types/signal";
import ConfidenceBadge from "./ConfidenceBadge";
import RiskBadge from "./RiskBadge";

const DIR: Record<Signal["direction"], string> = {
  BUY: "text-success",
  SELL: "text-danger",
  WAIT: "text-text-2",
};

export default function SignalTable({ signals }: { signals: Signal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-ink-2 text-left text-xs uppercase text-text-3">
          <tr>
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Signal</th>
            <th className="px-4 py-3">Timeframe</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Risk</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {signals.map((s) => (
            <tr key={s.id} className="hover:bg-ink-2">
              <td className="px-4 py-3 font-medium text-text">{s.symbol}</td>
              <td className={`px-4 py-3 font-semibold ${DIR[s.direction]}`}>{s.direction}</td>
              <td className="px-4 py-3 text-text-2">{s.timeframe}</td>
              <td className="px-4 py-3"><ConfidenceBadge score={s.confidence} /></td>
              <td className="px-4 py-3"><RiskBadge level={s.riskLevel} /></td>
              <td className="px-4 py-3 capitalize text-text-2">{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}