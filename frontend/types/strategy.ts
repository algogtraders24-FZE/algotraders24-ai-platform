// types/strategy.ts
import type { MarketCategory } from "./market";
import type { RiskLevel } from "./risk";

export interface Strategy {
  id: string;
  name: string;
  category: MarketCategory;
  timeframe: string;
  risk: RiskLevel;
  description: string;
  rules: string[];
}