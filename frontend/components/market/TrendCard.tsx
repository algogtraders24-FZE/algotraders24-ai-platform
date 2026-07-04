// components/market/TrendCard.tsx
import type { TrendDirection } from "@/types/market";

const MAP: Record<TrendDirection, string> = {
  bullish: "text-emerald-400",
  bearish: "text-red-400",
  neutral: "text-slate-400",
};

export default function TrendCard({ direction, strength }: { direction: TrendDirection; strength: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">Trend</p>
      <p className={`mt-1 text-lg font-bold capitalize ${MAP[direction]}`}>{direction}</p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800">
        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${strength}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Strength {strength}%</p>
    </div>
  );
}