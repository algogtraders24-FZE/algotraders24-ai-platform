// types/liquidity.ts
import type { MarketSymbol } from "./market";

export type LiquidityLevel = "thin" | "normal" | "deep";

export interface Liquidity {
  symbol: MarketSymbol;
  level: LiquidityLevel;
  score: number; // 0–100
  spread: number;
  updatedAt: string;
}