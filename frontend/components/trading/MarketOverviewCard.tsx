// components/trading/MarketOverviewCard.tsx
import type { MarketQuote } from "@/types/market-analysis";

export default function MarketOverviewCard({ quote }: { quote: MarketQuote }) {
  const up = quote.change >= 0;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-500">{quote.name}</p>
      <p className="mt-1 text-2xl font-bold text-slate-100">{quote.price.toLocaleString()}</p>
      <p className={`mt-1 text-sm font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
        {up ? "▲" : "▼"} {quote.change} ({quote.changePercent}%)
      </p>
    </div>
  );
}