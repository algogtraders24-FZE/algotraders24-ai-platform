// types/news.ts
import type { NewsImpact } from "./news-impact";

export type NewsCategory =
  | "forex"
  | "crypto"
  | "stocks"
  | "commodities"
  | "economy"
  | "central-bank";

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  category: NewsCategory;
  source: string;
  impact: NewsImpact;
  aiSummary: string;
  publishedAt: string;
}