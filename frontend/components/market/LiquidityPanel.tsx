// components/market/LiquidityPanel.tsx
import type { LiquidityLevel } from "@/types/liquidity";

const MAP: Record<LiquidityLevel, string> = {
  thin: "text-red-400",
  normal: "text-amber-400",
  deep: "text-emerald-400",
};

export default function LiquidityPanel({ level, score }: { level: LiquidityLevel; score: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">Liquidity</p>
      <p className={`mt-1 text-lg font-bold capitalize ${MAP[level]}`}>{level}</p>
      <p className="mt-1 text-xs text-slate-500">Score {score}</p>
    </div>
  );
}