// types/news-impact.ts
import type { MarketCategory } from "./market";

export type ImpactLevel = "low" | "medium" | "high";

export interface NewsImpact {
  level: ImpactLevel;
  score: number; // 0–100
  affectedMarkets: MarketCategory[];
  direction: "bullish" | "bearish" | "neutral";
}