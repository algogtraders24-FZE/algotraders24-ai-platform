// services/ai/publishing/content-planner.service.ts
import type { ContentCategory } from "@/types/content-category";
import type { FeatureMeta } from "@/types/feature-meta";

export const plannerMeta: FeatureMeta = {
  featureId: "content-planner",
  requiredPlan: "pro",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export interface ScheduledContent {
  category: ContentCategory;
  time: string;
  priority: number; // 1 (high) – 5 (low)
}

export function getDailySchedule(): ScheduledContent[] {
  return [
    { category: "gold-analysis", time: "07:00", priority: 1 },
    { category: "forex-analysis", time: "09:00", priority: 2 },
    { category: "crypto-analysis", time: "12:00", priority: 3 },
    { category: "index-analysis", time: "15:00", priority: 3 },
  ];
}

export function getWeeklySchedule(): ScheduledContent[] {
  return [
    { category: "weekly-review", time: "Sun 18:00", priority: 1 },
    { category: "market-outlook", time: "Mon 07:00", priority: 2 },
    { category: "economic-preview", time: "Wed 07:00", priority: 2 },
  ];
}