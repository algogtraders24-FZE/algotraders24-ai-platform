// services/ai/trading/market-bias.service.ts
import type { MarketBias, BiasDirection } from "@/types/market-bias";
import type { FeatureMeta } from "@/types/feature-meta";

export const marketBiasMeta: FeatureMeta = {
  featureId: "market-bias",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export function getBias(changePercent: number, trendStrength: number): MarketBias {
  let direction: BiasDirection = "neutral";
  if (changePercent > 0.15) direction = "bullish";
  else if (changePercent < -0.15) direction = "bearish";

  return {
    direction,
    confidence: Math.min(100, 50 + Math.round(trendStrength / 2)),
    reasoning:
      direction === "bullish"
        ? "Positive momentum with buyers in control."
        : direction === "bearish"
        ? "Negative momentum with sellers pressuring price."
        : "Price consolidating; no clear directional edge.",
  };
}