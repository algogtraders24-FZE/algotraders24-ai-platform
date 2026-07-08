// services/ai/publishing/internal-link.service.ts
import type { Article } from "@/types/article";
import type { FeatureMeta } from "@/types/feature-meta";

export const internalLinkMeta: FeatureMeta = {
  featureId: "internal-link",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export interface RelatedLink {
  title: string;
  url: string;
}

export function getRelatedArticles(current: Article, all: Article[]): RelatedLink[] {
  return all
    .filter((a) => a.id !== current.id && a.category === current.category)
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.seo.canonicalUrl }));
}

export function getSuggestedReading(all: Article[]): RelatedLink[] {
  return all
    .filter((a) => a.status === "published")
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.seo.canonicalUrl }));
}