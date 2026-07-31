// components/trading/MarketBiasCard.tsx
import type { MarketBias } from "@/types/market-bias";

const COLOR: Record<MarketBias["direction"], string> = {
  bullish: "text-success",
  bearish: "text-danger",
  neutral: "text-text-2",
};

export default function MarketBiasCard({ bias }: { bias: MarketBias }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="text-xs text-text-3">Market Bias</p>
      <p className={`mt-1 text-xl font-bold capitalize ${COLOR[bias.direction]}`}>{bias.direction}</p>
      <p className="mt-1 text-xs text-text-3">Confidence {bias.confidence}%</p>
      <p className="mt-2 text-xs text-text-2">{bias.reasoning}</p>
    </div>
  );
}