// data/mock-articles.ts
import type { Article } from "@/types/article";

function seo(title: string, slug: string, keywords: string[], score: number) {
  return {
    title,
    metaDescription: `${title} — professional market analysis, key levels, and outlook.`,
    keywords,
    slug,
    canonicalUrl: `https://algotraders24.com/blog/${slug}`,
    openGraph: { title, description: `${title} by Algotraders24 AI`, type: "article", url: `https://algotraders24.com/blog/${slug}` },
    twitter: { card: "summary_large_image", title, description: `${title} — Algotraders24 AI` },
    score,
  };
}

export const mockArticles: Article[] = [
  {
    id: "art-001",
    title: "Gold (XAUUSD) Daily Analysis",
    category: "gold-analysis",
    summary: "Gold holds above key support as buyers defend the trend.",
    sections: [
      { heading: "Market Overview", body: "Gold trades near 2685 with a mild bullish bias intraday." },
      { heading: "Key Levels", body: "Support 2670 and 2653; resistance 2701 and 2717." },
      { heading: "Outlook", body: "A hold above 2670 keeps upside open toward 2717." },
    ],
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: seo("Gold XAUUSD Daily Analysis", "gold-xauusd-daily-analysis", ["gold", "xauusd", "gold analysis", "trading"], 82),
    status: "published",
    createdAt: "2025-01-15T06:00:00Z",
    scheduledFor: null,
    publishedAt: "2025-01-15T07:00:00Z",
  },
  {
    id: "art-002",
    title: "Forex Market Outlook",
    category: "forex-analysis",
    summary: "EURUSD and GBPUSD setups ahead of key data.",
    sections: [
      { heading: "EURUSD", body: "Bullish while above 1.0810; targets 1.0880." },
      { heading: "GBPUSD", body: "Sellers active below 1.2750." },
    ],
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: seo("Forex Market Outlook", "forex-market-outlook", ["forex", "eurusd", "gbpusd", "outlook"], 76),
    status: "scheduled",
    createdAt: "2025-01-15T06:10:00Z",
    scheduledFor: "2025-01-15T12:00:00Z",
    publishedAt: null,
  },
  {
    id: "art-003",
    title: "Crypto Market Update",
    category: "crypto-analysis",
    summary: "Bitcoin cools near resistance; alts follow.",
    sections: [
      { heading: "Bitcoin", body: "BTC rejected near 95K; watch 90K support." },
      { heading: "Ethereum", body: "ETH holds 3300 with buyers defending." },
    ],
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: seo("Crypto Market Update", "crypto-market-update", ["crypto", "bitcoin", "ethereum", "btc"], 71),
    status: "draft",
    createdAt: "2025-01-15T06:20:00Z",
    scheduledFor: null,
    publishedAt: null,
  },
  {
    id: "art-004",
    title: "NIFTY Outlook",
    category: "index-analysis",
    summary: "Nifty consolidates near highs.",
    sections: [
      { heading: "Trend", body: "Index holds above 23400 support." },
      { heading: "Levels", body: "Resistance 23700; support 23400." },
    ],
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: seo("NIFTY Outlook", "nifty-outlook", ["nifty", "index", "nse", "outlook"], 68),
    status: "draft",
    createdAt: "2025-01-15T06:30:00Z",
    scheduledFor: null,
    publishedAt: null,
  },
  {
    id: "art-005",
    title: "Weekly Market Review",
    category: "weekly-review",
    summary: "Recap of the week across gold, forex, crypto, and indices.",
    sections: [
      { heading: "Summary", body: "Risk sentiment improved into the weekend." },
      { heading: "Week Ahead", body: "CPI and central-bank speakers in focus." },
    ],
    disclaimer: "This is not financial advice. Trading involves risk.",
    seo: seo("Weekly Market Review", "weekly-market-review", ["weekly review", "markets", "recap"], 79),
    status: "published",
    createdAt: "2025-01-12T06:00:00Z",
    scheduledFor: null,
    publishedAt: "2025-01-12T08:00:00Z",
  },
];