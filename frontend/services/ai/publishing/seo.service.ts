// services/ai/publishing/seo.service.ts
import type { SeoMetadata } from "@/types/seo-metadata";
import type { FeatureMeta } from "@/types/feature-meta";

export const seoMeta: FeatureMeta = {
  featureId: "seo-generator",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildSeo(title: string, keywords: string[]): SeoMetadata {
  const slug = slugify(title);
  const url = `https://algotraders24.com/blog/${slug}`;
  const description = `${title} — professional market analysis, key levels, and outlook from Algotraders24 AI.`;

  let score = 60;
  if (title.length >= 30 && title.length <= 65) score += 15;
  if (keywords.length >= 3) score += 15;
  if (description.length >= 120 && description.length <= 160) score += 10;

  return {
    title,
    metaDescription: description,
    keywords,
    slug,
    canonicalUrl: url,
    openGraph: { title, description, type: "article", url },
    twitter: { card: "summary_large_image", title, description },
    score: Math.min(100, score),
  };
}