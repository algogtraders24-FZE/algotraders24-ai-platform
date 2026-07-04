// components/market/VolatilityCard.tsx
import type { VolatilityLevel } from "@/types/volatility";

const MAP: Record<VolatilityLevel, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

export default function VolatilityCard({ level, value }: { level: VolatilityLevel; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">Volatility</p>
      <p className={`mt-1 text-lg font-bold capitalize ${MAP[level]}`}>{level}</p>
      <p className="mt-1 text-xs text-slate-500">Index {value}</p>
    </div>
  );
}