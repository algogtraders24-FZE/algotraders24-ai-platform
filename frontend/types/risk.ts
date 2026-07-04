// types/risk.ts
// AI Signal Engine — risk types

export type RiskLevel = "low" | "medium" | "high";

export interface RiskScore {
  level: RiskLevel;
  score: number; // 0–100
  volatility: number; // 0–100
  exposurePercent: number;
}

export interface RiskAssessment {
  signalId: string;
  risk: RiskScore;
  maxDrawdownPercent: number;
  riskRewardRatio: number;
  notes: string;
}