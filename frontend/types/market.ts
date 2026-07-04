// types/market.ts
// AI Signal Engine — market types

export type MarketCategory =
  | "forex"
  | "crypto"
  | "indices"
  | "stocks"
  | "commodities";

export type MarketSymbol = string;

export type TrendDirection = "bullish" | "bearish" | "neutral";

export interface Market {
  symbol: MarketSymbol;
  name: string;
  category: MarketCategory;
  baseCurrency: string;
  quoteCurrency: string;
  active: boolean;
}

export interface MarketQuote {
  symbol: MarketSymbol;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume: number;
  updatedAt: string;
}

export interface MarketTrend {
  symbol: MarketSymbol;
  direction: TrendDirection;
  strength: number; // 0–100
  timeframe: string;
}