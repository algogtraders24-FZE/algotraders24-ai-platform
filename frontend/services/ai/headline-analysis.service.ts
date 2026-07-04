// services/ai/headline-analysis.service.ts
import type { NewsArticle } from "@/types/news";
import { news } from "@/data/news";

export function getAiSummary(id: string): string | undefined {
  return news.find((n) => n.id === id)?.aiSummary;
}

export function getMarketImpactSummary(): string {
  const high = news.filter((n) => n.impact.level === "high").length;
  return `${high} high-impact stories affecting markets today.`;
}