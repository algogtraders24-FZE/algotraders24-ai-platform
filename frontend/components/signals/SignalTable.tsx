// components/signals/SignalTable.tsx
import type { Signal } from "@/types/signal";
import ConfidenceBadge from "./ConfidenceBadge";
import RiskBadge from "./RiskBadge";

const DIR: Record<Signal["direction"], string> = {
  BUY: "text-emerald-400",
  SELL: "text-red-400",
  WAIT: "text-slate-400",
};

export default function SignalTable({ signals }: { signals: Signal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Signal</th>
            <th className="px-4 py-3">Timeframe</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Risk</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {signals.map((s) => (
            <tr key={s.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3 font-medium text-slate-100">{s.symbol}</td>
              <td className={`px-4 py-3 font-semibold ${DIR[s.direction]}`}>{s.direction}</td>
              <td className="px-4 py-3 text-slate-400">{s.timeframe}</td>
              <td className="px-4 py-3"><ConfidenceBadge score={s.confidence} /></td>
              <td className="px-4 py-3"><RiskBadge level={s.riskLevel} /></td>
              <td className="px-4 py-3 capitalize text-slate-400">{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}