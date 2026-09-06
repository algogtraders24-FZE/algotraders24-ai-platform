// services/news/store.service.ts
// AN1.2/AN1.6 - the ONE place that reads/writes the shared NewsArticle
// store. Market Intelligence's evidence path and the AI News read API both
// go through this file; neither imports a provider adapter directly (the
// "read API must not reach Alpha Vantage/CryptoPanic directly" rule is
// enforced structurally by what each caller is allowed to import).
import "server-only";
import { prisma } from "@/lib/prisma";
import type { NormalizedNewsArticle } from "./normalize.service";
import type { MarketSymbol } from "@/types/market";
import type { NewsCategory } from "./relevance.service";

/** Upserts by dedupeKey - re-ingesting the same real article (a later cron cycle sees it again in the feed) updates it in place rather than creating a duplicate row. Returns how many were genuinely NEW, for ingestion-run observability. */
export async function persistArticles(articles: NormalizedNewsArticle[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const article of articles) {
    const data = {
      provider: article.provider,
      providerArticleId: article.providerArticleId,
      headline: article.headline,
      summary: article.summary,
      url: article.url,
      sourceName: article.sourceName,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
      sentimentScore: article.sentimentScore,
      sentimentLabel: article.sentimentLabel,
      relevanceByAsset: article.relevanceByAsset ?? undefined,
      category: article.category,
      assetTags: article.assetTags,
      tagProvenance: article.tagProvenance ?? undefined,
      processingStatus: "processed" as const,
      rawPayload: article.rawPayload as object,
    };
    const existing = await prisma.newsArticle.findUnique({ where: { dedupeKey: article.dedupeKey }, select: { id: true } });
    await prisma.newsArticle.upsert({
      where: { dedupeKey: article.dedupeKey },
      create: { dedupeKey: article.dedupeKey, ...data },
      update: data,
    });
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated };
}

export interface NewsQueryFilters {
  symbols?: MarketSymbol[];
  category?: NewsCategory;
  provider?: string;
}

export interface NewsQueryPage {
  page: number;
  pageSize: number;
}

export async function queryNewsArticles(filters: NewsQueryFilters, page: NewsQueryPage) {
  const where = {
    deletedAt: null,
    ...(filters.symbols && filters.symbols.length > 0 ? { assetTags: { hasSome: filters.symbols } } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.newsArticle.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    prisma.newsArticle.count({ where }),
  ]);

  return { items, total };
}

/** Real alpha-vantage articles currently in the store, for Market Intelligence's evidence mapping - freshness itself is decided by the CALLER via ProviderQuota/ProviderCallLog, not by this read. */
export async function getStoredArticlesByProvider(provider: string, limit: number) {
  return prisma.newsArticle.findMany({
    where: { provider, deletedAt: null },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: limit,
  });
}
