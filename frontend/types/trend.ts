// types/trend.ts
import type { MarketSymbol, TrendDirection } from "./market";

export interface Trend {
  symbol: MarketSymbol;
  direction: TrendDirection;
  strength: number; // 0–100
  timeframe: string;
  updatedAt: string;
}