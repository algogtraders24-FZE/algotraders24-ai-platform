// config/news.config.ts
import type { NewsCategory } from "@/types/news";
import type { ImpactLevel } from "@/types/news-impact";
import type { EventImportance } from "@/types/economic-event";

export const NEWS_CATEGORIES: NewsCategory[] = [
  "forex",
  "crypto",
  "stocks",
  "commodities",
  "economy",
  "central-bank",
];

export const IMPACT_LEVELS: ImpactLevel[] = ["low", "medium", "high"];

export const IMPORTANCE_LEVELS: EventImportance[] = ["low", "medium", "high"];

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF"] as const;

export const COUNTRIES = [
  "United States",
  "Eurozone",
  "United Kingdom",
  "Japan",
  "Australia",
  "Canada",
] as const;

export const NEWS_ENGINE = {
  version: "1.0.0-foundation",
  source: "ai-news-engine",
  maxHeadlines: 50,
} as const;