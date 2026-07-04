// components/market/MarketOverview.tsx
import type { MarketIntelligence } from "@/types/market-intelligence";
import TrendCard from "./TrendCard";
import SentimentGauge from "./SentimentGauge";
import VolatilityCard from "./VolatilityCard";
import LiquidityPanel from "./LiquidityPanel";

export default function MarketOverview({ data }: { data: MarketIntelligence }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-100">{data.symbol}</h3>
          <p className="text-xs capitalize text-slate-500">{data.category}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-indigo-400">{data.overallScore}</p>
          <p className="text-xs text-slate-500">Market Score</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TrendCard direction={data.trend} strength={data.trendStrength} />
        <SentimentGauge label={data.sentiment} score={data.sentimentScore} />
        <VolatilityCard level={data.volatility} value={data.overallScore} />
        <LiquidityPanel level={data.liquidity} score={data.overallScore} />
      </div>

      <p className="mt-4 text-sm text-slate-400">{data.summary}</p>
      <p className="mt-2 text-xs text-slate-600">Confidence {data.confidence}%</p>
    </div>
  );
}