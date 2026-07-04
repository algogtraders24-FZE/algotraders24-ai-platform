// services/ai/volatility.service.ts
import type { Volatility, VolatilityLevel } from "@/types/volatility";
import type { MarketSymbol } from "@/types/market";
import { marketIntelligence } from "@/data/market-intelligence";

const VALUE_MAP: Record<VolatilityLevel, number> = { low: 25, medium: 55, high: 85 };

export function getVolatilityBySymbol(symbol: MarketSymbol): Volatility | undefined {
  const mi = marketIntelligence.find((m) => m.symbol === symbol);
  if (!mi) return undefined;
  return {
    symbol,
    level: mi.volatility,
    value: VALUE_MAP[mi.volatility],
    updatedAt: mi.updatedAt,
  };
}