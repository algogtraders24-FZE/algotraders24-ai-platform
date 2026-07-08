// services/ai/publishing/article-validator.service.ts
import type { Article } from "@/types/article";
import type { FeatureMeta } from "@/types/feature-meta";

export const validatorMeta: FeatureMeta = {
  featureId: "article-validator",
  requiredPlan: "free",
  estimatedCost: 1,
  dailyUsageWeight: 1,
};

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  seoScore: number;
}

export function validateArticle(article: Article): ValidationResult {
  const issues: string[] = [];

  if (article.sections.length < 3) issues.push("Article should have at least 3 sections.");

  const headings = article.sections.map((s) => s.heading.toLowerCase());
  if (new Set(headings).size !== headings.length) issues.push("Duplicate headings found.");

  if (!article.disclaimer) issues.push("Missing disclaimer.");
  if (!article.summary || article.summary.length < 20) issues.push("Summary too short.");
  if (article.seo.keywords.length < 3) issues.push("Fewer than 3 SEO keywords.");
  if (article.seo.score < 70) issues.push("SEO score below 70.");

  return {
    valid: issues.length === 0,
    issues,
    seoScore: article.seo.score,
  };
}