// types/market-intelligence.ts
import type { MarketSymbol, MarketCategory } from "./market";
import type { TrendDirection } from "./market";
import type { SentimentLabel } from "./sentiment";
import type { VolatilityLevel } from "./volatility";
import type { LiquidityLevel } from "./liquidity";

export interface MarketIntelligence {
  symbol: MarketSymbol;
  category: MarketCategory;
  overallScore: number; // 0–100
  trend: TrendDirection;
  trendStrength: number; // 0–100
  sentiment: SentimentLabel;
  sentimentScore: number; // -100 to 100
  volatility: VolatilityLevel;
  liquidity: LiquidityLevel;
  confidence: number; // 0–100
  summary: string;
  updatedAt: string;
}