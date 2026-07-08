// services/ai/publishing/content-generator.service.ts
import type { Article, ArticleSection } from "@/types/article";
import type { ContentCategory } from "@/types/content-category";
import type { FeatureMeta } from "@/types/feature-meta";
import { buildSeo } from "./seo.service";

export const generatorMeta: FeatureMeta = {
  featureId: "content-generator",
  requiredPlan: "pro",
  estimatedCost: 3,
  dailyUsageWeight: 3,
};

const DISCLAIMER = "This is not financial advice. Trading involves risk.";

const CATEGORY_TITLES: Record<ContentCategory, string> = {
  "technical-analysis": "Technical Analysis",
  "fundamental-analysis": "Fundamental Analysis",
  "market-outlook": "Market Outlook",
  "economic-preview": "Economic Event Preview",
  "forex-analysis": "Forex Analysis",
  "gold-analysis": "Gold Analysis",
  "crypto-analysis": "Crypto Analysis",
  "index-analysis": "Stock Index Analysis",
  "weekly-review": "Weekly Market Review",
};

export function generateArticle(category: ContentCategory, keywords: string[]): Article {
  const title = CATEGORY_TITLES[category];
  const sections: ArticleSection[] = [
    { heading: "Market Overview", body: "Current conditions and sentiment for the covered market." },
    { heading: "Key Levels", body: "Important support, resistance, and breakout zones." },
    { heading: "Outlook", body: "Directional bias and scenarios to watch." },
  ];

  return {
    id: `art-${Date.now()}`,
    title,
    category,
    summary: `${title}: overview, key levels, and outlook.`,
    sections,
    disclaimer: DISCLAIMER,
    seo: buildSeo(title, keywords),
    status: "draft",
    createdAt: new Date().toISOString(),
    scheduledFor: null,
    publishedAt: null,
  };
}