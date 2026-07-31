// components/trading/MarketOverviewCard.tsx
import type { MarketQuote } from "@/types/market-analysis";

export default function MarketOverviewCard({ quote }: { quote: MarketQuote }) {
  const up = quote.change >= 0;
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="text-xs text-text-3">{quote.name}</p>
      <p className="mt-1 text-2xl font-bold text-text">{quote.price.toLocaleString()}</p>
      <p className={`mt-1 text-sm font-semibold ${up ? "text-success" : "text-danger"}`}>
        {up ? "▲" : "▼"} {quote.change} ({quote.changePercent}%)
      </p>
    </div>
  );
}