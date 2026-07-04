// services/ai/news-impact.service.ts
import type { NewsArticle } from "@/types/news";
import type { MarketCategory } from "@/types/market";
import { news } from "@/data/news";

export function getHighImpactNews(): NewsArticle[] {
  return news.filter((n) => n.impact.level === "high");
}

export function getNewsByMarket(market: MarketCategory): NewsArticle[] {
  return news.filter((n) => n.impact.affectedMarkets.includes(market));
}