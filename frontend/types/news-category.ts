// types/news-category.ts
// AN1.5 - AT24's own deterministic news category taxonomy. Extracted out of
// services/news/relevance.service.ts (which is `server-only`) into a plain
// shared module, since both the read API (server) and the AI News page
// filter UI (client) need the exact same list - one source of truth,
// importable from either side.
export const NEWS_CATEGORIES = ["Monetary Policy", "Economic Data", "Commodities", "Corporate", "Crypto"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
