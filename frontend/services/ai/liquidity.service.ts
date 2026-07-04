// services/ai/liquidity.service.ts
import type { Liquidity, LiquidityLevel } from "@/types/liquidity";
import type { MarketSymbol } from "@/types/market";
import { marketIntelligence } from "@/data/market-intelligence";

const SCORE_MAP: Record<LiquidityLevel, number> = { thin: 30, normal: 60, deep: 90 };

export function getLiquidityBySymbol(symbol: MarketSymbol): Liquidity | undefined {
  const mi = marketIntelligence.find((m) => m.symbol === symbol);
  if (!mi) return undefined;
  return {
    symbol,
    level: mi.liquidity,
    score: SCORE_MAP[mi.liquidity],
    spread: mi.liquidity === "deep" ? 0.1 : mi.liquidity === "normal" ? 0.3 : 0.6,
    updatedAt: mi.updatedAt,
  };
}