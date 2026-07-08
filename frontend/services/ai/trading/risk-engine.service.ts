// services/ai/trading/risk-engine.service.ts
import type { RiskAnalysis, TradeQuality } from "@/types/risk-analysis";
import type { FeatureMeta } from "@/types/feature-meta";

export const riskMeta: FeatureMeta = {
  featureId: "risk-engine",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export function getRisk(riskReward: number, confidence: number): RiskAnalysis {
  let quality: TradeQuality = "low";
  if (confidence >= 85 && riskReward >= 2) quality = "premium";
  else if (confidence >= 70 && riskReward >= 1.5) quality = "high";
  else if (confidence >= 55) quality = "medium";

  return {
    riskPercent: 1,
    riskRewardRatio: +riskReward.toFixed(2),
    suggestedLotSize: +(confidence / 100).toFixed(2),
    tradeQuality: quality,
  };
}