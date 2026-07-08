// components/trading/TechnicalAnalysisCard.tsx
import type { TechnicalIndicators } from "@/types/technical-analysis";

export default function TechnicalAnalysisCard({ indicators }: { indicators: TechnicalIndicators }) {
  const rows: [string, string | number][] = [
    ["EMA", indicators.ema],
    ["RSI", indicators.rsi],
    ["MACD", indicators.macd],
    ["ATR", indicators.atr],
    ["Trend Strength", `${indicators.trendStrength}/100`],
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Technical Analysis</p>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium text-slate-200">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}