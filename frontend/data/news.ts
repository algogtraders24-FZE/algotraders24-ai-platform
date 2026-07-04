// data/news.ts
import type { NewsArticle } from "@/types/news";

export const news: NewsArticle[] = [
  {
    id: "news-001",
    headline: "Fed signals possible rate cut in Q2",
    summary: "Federal Reserve hints at easing amid cooling inflation.",
    category: "central-bank",
    source: "MockWire",
    impact: { level: "high", score: 88, affectedMarkets: ["forex", "indices"], direction: "bullish" },
    aiSummary: "Dovish tone supports risk assets; USD likely to weaken.",
    publishedAt: "2025-01-15T09:00:00Z",
  },
  {
    id: "news-002",
    headline: "Bitcoin rejected at key resistance",
    summary: "BTC fails to break $95K, pulls back sharply.",
    category: "crypto",
    source: "MockWire",
    impact: { level: "medium", score: 60, affectedMarkets: ["crypto"], direction: "bearish" },
    aiSummary: "Short-term bearish; watch $90K support.",
    publishedAt: "2025-01-15T08:30:00Z",
  },
  {
    id: "news-003",
    headline: "Gold steadies as dollar softens",
    summary: "XAU holds gains on safe-haven demand.",
    category: "commodities",
    source: "MockWire",
    impact: { level: "low", score: 35, affectedMarkets: ["commodities"], direction: "neutral" },
    aiSummary: "Range-bound; limited directional impact.",
    publishedAt: "2025-01-15T07:45:00Z",
  },
];