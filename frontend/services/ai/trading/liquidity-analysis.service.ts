// services/ai/trading/liquidity-analysis.service.ts
import type { LiquidityZones } from "@/types/technical-analysis";
import type { FeatureMeta } from "@/types/feature-meta";

export const liquidityMeta: FeatureMeta = {
  featureId: "liquidity-analysis",
  requiredPlan: "pro",
  estimatedCost: 2,
  dailyUsageWeight: 2,
};

export function getLiquidity(price: number): LiquidityZones {
  const step = price * 0.005;
  return {
    buySide: [+(price + step).toFixed(2), +(price + step * 2).toFixed(2)],
    sellSide: [+(price - step).toFixed(2), +(price - step * 2).toFixed(2)],
    equalHighs: [+(price + step * 1.5).toFixed(2)],
    equalLows: [+(price - step * 1.5).toFixed(2)],
  };
}