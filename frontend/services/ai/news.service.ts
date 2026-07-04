// services/ai/news.service.ts
import type { NewsArticle, NewsCategory } from "@/types/news";
import { news } from "@/data/news";

export function getNews(): NewsArticle[] {
  return news;
}

export function getNewsByCategory(category: NewsCategory): NewsArticle[] {
  return news.filter((n) => n.category === category);
}

export function getLatestNews(limit = 10): NewsArticle[] {
  return [...news]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}