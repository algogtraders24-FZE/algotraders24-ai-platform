// data/analysis.ts
// AI Signal Engine — mock market analysis

import type { MarketAnalysis } from "@/types/analysis";

export const marketAnalyses: MarketAnalysis[] = [
  {
    symbol: "EURUSD",
    category: "forex",
    timeframe: "1h",
    trend: "bullish",
    trendStrength: 78,
    indicators: [
      { name: "RSI", value: 61, signal: "buy" },
      { name: "MACD", value: 0.0012, signal: "buy" },
      { name: "EMA50", value: 1.0825, signal: "buy" },
    ],
    summary: "Momentum favors upside continuation.",
    analyzedAt: "2025-01-15T09:30:00Z",
  },
  {
    symbol: "BTCUSD",
    category: "crypto",
    timeframe: "4h",
    trend: "bearish",
    trendStrength: 64,
    indicators: [
      { name: "RSI", value: 72, signal: "sell" },
      { name: "MACD", value: -120, signal: "sell" },
      { name: "EMA50", value: 95200, signal: "sell" },
    ],
    summary: "Overbought near resistance; pullback likely.",
    analyzedAt: "2025-01-15T08:00:00Z",
  },
  {
    symbol: "XAUUSD",
    category: "commodities",
    timeframe: "1d",
    trend: "neutral",
    trendStrength: 45,
    indicators: [
      { name: "RSI", value: 52, signal: "neutral" },
      { name: "MACD", value: 0.4, signal: "neutral" },
      { name: "EMA50", value: 2680, signal: "neutral" },
    ],
    summary: "Range-bound; awaiting directional catalyst.",
    analyzedAt: "2025-01-15T07:00:00Z",
  },
];