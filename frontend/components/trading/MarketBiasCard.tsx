// components/trading/MarketBiasCard.tsx
import type { MarketBias } from "@/types/market-bias";

const COLOR: Record<MarketBias["direction"], string> = {
  bullish: "text-emerald-400",
  bearish: "text-red-400",
  neutral: "text-slate-400",
};

export default function MarketBiasCard({ bias }: { bias: MarketBias }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">Market Bias</p>
      <p className={`mt-1 text-xl font-bold capitalize ${COLOR[bias.direction]}`}>{bias.direction}</p>
      <p className="mt-1 text-xs text-slate-500">Confidence {bias.confidence}%</p>
      <p className="mt-2 text-xs text-slate-400">{bias.reasoning}</p>
    </div>
  );
}