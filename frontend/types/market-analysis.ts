// types/market-analysis.ts
import type { MarketBias } from "./market-bias";
import type { TechnicalIndicators, SupportResistance, LiquidityZones } from "./technical-analysis";
import type { RiskAnalysis } from "./risk-analysis";
import type { TradeSetup } from "./trade-setup";

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface MarketAnalysis {
  quote: MarketQuote;
  bias: MarketBias;
  indicators: TechnicalIndicators;
  levels: SupportResistance;
  liquidity: LiquidityZones;
  risk: RiskAnalysis;
  setup: TradeSetup;
  confidence: number;
  reasoning: string;
  warnings: string[];
  nextActions: string[];
}