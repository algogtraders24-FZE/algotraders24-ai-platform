// services/ai/market-analysis.service.ts
// AI Signal Engine — market analysis service (mock only)

import type { MarketAnalysis } from "@/types/analysis";
import type { MarketSymbol } from "@/types/market";
import { marketAnalyses } from "@/data/analysis";

export function getAnalyses(): MarketAnalysis[] {
  return marketAnalyses;
}

export function getAnalysisBySymbol(
  symbol: MarketSymbol
): MarketAnalysis | undefined {
  return marketAnalyses.find((a) => a.symbol === symbol);
}