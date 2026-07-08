// services/ai/trading/technical-analysis.service.ts
import type { TechnicalIndicators } from "@/types/technical-analysis";
import type { FeatureMeta } from "@/types/feature-meta";

export const technicalMeta: FeatureMeta = {
  featureId: "technical-analysis",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export function getIndicators(price: number): TechnicalIndicators {
  const seed = price % 100;
  return {
    ema: +(price * 0.995).toFixed(2),
    rsi: +(40 + (seed % 40)).toFixed(1),
    macd: +((seed % 10) - 5).toFixed(2),
    atr: +(price * 0.004).toFixed(2),
    trendStrength: Math.min(100, 45 + (seed % 50)),
  };
}