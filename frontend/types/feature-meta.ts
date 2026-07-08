// types/feature-meta.ts
export type RequiredPlan = "free" | "pro" | "premium";

export interface FeatureMeta {
  featureId: string;
  requiredPlan: RequiredPlan;
  estimatedCost: number; // relative units
  dailyUsageWeight: number;
}