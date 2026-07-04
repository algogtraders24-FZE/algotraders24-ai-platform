// types/volatility.ts
import type { MarketSymbol } from "./market";

export type VolatilityLevel = "low" | "medium" | "high";

export interface Volatility {
  symbol: MarketSymbol;
  level: VolatilityLevel;
  value: number; // 0–100
  updatedAt: string;
}