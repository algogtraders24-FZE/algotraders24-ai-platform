// app/dashboard/market-intelligence/page.tsx
import { getMarketIntelligence, getOverallMarketScore } from "@/services/ai/market-intelligence.service";
import MarketOverview from "@/components/market/MarketOverview";

export default function MarketIntelligencePage() {
  const data = getMarketIntelligence();
  const overall = getOverallMarketScore();

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">AI Market Intelligence</h1>
            <p className="text-sm text-slate-500">Real-time market analysis · mock data</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-indigo-400">{overall}</p>
            <p className="text-xs text-slate-500">Overall Market Score</p>
          </div>
        </header>

        <div className="space-y-5">
          {data.map((mi) => (
            <MarketOverview key={mi.symbol} data={mi} />
          ))}
        </div>
      </div>
    </div>
  );
}