// services/ai/trading/support-resistance.service.ts
import type { SupportResistance } from "@/types/technical-analysis";
import type { FeatureMeta } from "@/types/feature-meta";

export const supportResistanceMeta: FeatureMeta = {
  featureId: "support-resistance",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export function getLevels(price: number): SupportResistance {
  const step = price * 0.006;
  return {
    support: [+(price - step).toFixed(2), +(price - step * 2).toFixed(2)],
    resistance: [+(price + step).toFixed(2), +(price + step * 2).toFixed(2)],
    breakoutZones: [+(price + step * 3).toFixed(2)],
  };
}