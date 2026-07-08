// types/risk-analysis.ts
export type TradeQuality = "low" | "medium" | "high" | "premium";

export interface RiskAnalysis {
  riskPercent: number;
  riskRewardRatio: number;
  suggestedLotSize: number;
  tradeQuality: TradeQuality;
}