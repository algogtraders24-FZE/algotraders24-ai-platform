// types/market-bias.ts
export type BiasDirection = "bullish" | "bearish" | "neutral";

export interface MarketBias {
  direction: BiasDirection;
  confidence: number; // 0–100
  reasoning: string;
}