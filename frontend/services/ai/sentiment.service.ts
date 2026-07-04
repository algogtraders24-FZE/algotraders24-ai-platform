// services/ai/sentiment.service.ts
import type { Sentiment } from "@/types/sentiment";
import type { MarketSymbol } from "@/types/market";
import { sentiments } from "@/data/sentiment";

export function getSentiments(): Sentiment[] {
  return sentiments;
}

export function getSentimentBySymbol(symbol: MarketSymbol): Sentiment | undefined {
  return sentiments.find((s) => s.symbol === symbol);
}