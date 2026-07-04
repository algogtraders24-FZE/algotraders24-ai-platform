// types/analysis.ts
// AI Signal Engine — market analysis types

import type { MarketCategory, MarketSymbol, TrendDirection } from "./market";
import type { SignalTimeframe } from "./signal";

export type IndicatorSignal = "buy" | "sell" | "neutral";

export interface TechnicalIndicator {
  name: string;
  value: number;
  signal: IndicatorSignal;
}

export interface MarketAnalysis {
  symbol: MarketSymbol;
  category: MarketCategory;
  timeframe: SignalTimeframe;
  trend: TrendDirection;
  trendStrength: number; // 0–100
  indicators: TechnicalIndicator[];
  summary: string;
  analyzedAt: string;
}

export interface ConfidenceBreakdown {
  trendScore: number;
  indicatorScore: number;
  volumeScore: number;
  total: number; // 0–100
}