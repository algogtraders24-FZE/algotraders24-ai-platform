// types/sentiment.ts
import type { MarketSymbol } from "./market";

export type SentimentLabel = "bullish" | "bearish" | "neutral";

export interface Sentiment {
  symbol: MarketSymbol;
  label: SentimentLabel;
  score: number; // -100 to 100
  confidence: number; // 0–100
  updatedAt: string;
}