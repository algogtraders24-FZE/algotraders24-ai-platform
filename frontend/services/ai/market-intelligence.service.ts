// services/ai/market-intelligence.service.ts
import type { MarketIntelligence } from "@/types/market-intelligence";
import type { MarketSymbol } from "@/types/market";
import { marketIntelligence } from "@/data/market-intelligence";

export function getMarketIntelligence(): MarketIntelligence[] {
  return marketIntelligence;
}

export function getIntelligenceBySymbol(symbol: MarketSymbol): MarketIntelligence | undefined {
  return marketIntelligence.find((m) => m.symbol === symbol);
}

export function getOverallMarketScore(): number {
  if (marketIntelligence.length === 0) return 0;
  const sum = marketIntelligence.reduce((acc, m) => acc + m.overallScore, 0);
  return Math.round(sum / marketIntelligence.length);
}