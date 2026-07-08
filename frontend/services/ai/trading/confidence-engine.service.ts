// services/ai/trading/confidence-engine.service.ts
import type { FeatureMeta } from "@/types/feature-meta";

export const confidenceMeta: FeatureMeta = {
  featureId: "confidence-engine",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

// Weighted mock factors.
export function getConfidence(biasConfidence: number, trendStrength: number, riskReward: number): number {
  const rrScore = Math.min(100, riskReward * 40);
  const score = biasConfidence * 0.4 + trendStrength * 0.35 + rrScore * 0.25;
  return Math.round(Math.min(100, score));
}