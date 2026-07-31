// components/trading/SupportResistanceCard.tsx
import type { SupportResistance } from "@/types/technical-analysis";

export default function SupportResistanceCard({ levels }: { levels: SupportResistance }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Support / Resistance</p>
      <div className="space-y-1 text-xs">
        <p className="text-text-3">Resistance</p>
        {levels.resistance.map((r) => <p key={r} className="text-danger">{r}</p>)}
        <p className="mt-2 text-text-3">Support</p>
        {levels.support.map((s) => <p key={s} className="text-success">{s}</p>)}
        <p className="mt-2 text-text-3">Breakout</p>
        {levels.breakoutZones.map((b) => <p key={b} className="text-gold">{b}</p>)}
      </div>
    </div>
  );
}