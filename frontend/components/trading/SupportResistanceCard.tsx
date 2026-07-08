// components/trading/SupportResistanceCard.tsx
import type { SupportResistance } from "@/types/technical-analysis";

export default function SupportResistanceCard({ levels }: { levels: SupportResistance }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Support / Resistance</p>
      <div className="space-y-1 text-xs">
        <p className="text-slate-500">Resistance</p>
        {levels.resistance.map((r) => <p key={r} className="text-red-400">{r}</p>)}
        <p className="mt-2 text-slate-500">Support</p>
        {levels.support.map((s) => <p key={s} className="text-emerald-400">{s}</p>)}
        <p className="mt-2 text-slate-500">Breakout</p>
        {levels.breakoutZones.map((b) => <p key={b} className="text-indigo-400">{b}</p>)}
      </div>
    </div>
  );
}