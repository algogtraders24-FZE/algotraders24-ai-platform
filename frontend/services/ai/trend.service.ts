// services/ai/trend.service.ts
import type { Trend } from "@/types/trend";
import type { MarketSymbol } from "@/types/market";
import { trends } from "@/data/trend";

export function getTrends(): Trend[] {
  return trends;
}

export function getTrendBySymbol(symbol: MarketSymbol): Trend | undefined {
  return trends.find((t) => t.symbol === symbol);
}