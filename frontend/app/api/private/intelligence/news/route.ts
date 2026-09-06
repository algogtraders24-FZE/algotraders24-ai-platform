// app/api/private/intelligence/news/route.ts
// AN1.6 - the AI News read API. Reads ONLY the shared NewsArticle store via
// services/news/store.service.ts and services/news/quota.service.ts -
// notice there is no import of any provider adapter anywhere in this file.
// That's a structural guarantee, not just a design intention: this route
// physically cannot reach Alpha Vantage/CryptoPanic even by mistake.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { queryNewsArticles } from "@/services/news/store.service";
import { getLatestSuccessfulCallAt } from "@/services/news/quota.service";
import { staleThresholdMs } from "@/services/news/config";
import { NEWS_CATEGORIES, type NewsCategory } from "@/types/news-category";
import { isKnownMarket } from "@/lib/market-data/market-registry";
import type { MarketSymbol } from "@/types/market";

const KNOWN_PROVIDERS = ["alpha-vantage", "cryptopanic"];

function isNewsCategory(value: string): value is NewsCategory {
  return (NEWS_CATEGORIES as readonly string[]).includes(value);
}

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);

  // impact is deliberately not a real filter yet (AN1.5: not validated as a
  // meaningful signal) - reject rather than silently accept and ignore it.
  if (url.searchParams.has("impact")) {
    return ApiResponse.error({ code: "VALIDATION", message: "impact filtering is not yet available" }, ctx.requestId, 400, ctx.startedAt);
  }

  let symbols: MarketSymbol[] | undefined;
  const symbolParam = url.searchParams.get("symbol");
  if (symbolParam) {
    symbols = symbolParam.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = symbols.filter((s) => !isKnownMarket(s));
    if (unknown.length > 0) {
      return ApiResponse.error({ code: "VALIDATION", message: `Unknown symbol(s): ${unknown.join(", ")}` }, ctx.requestId, 400, ctx.startedAt);
    }
  }

  let category: NewsCategory | undefined;
  const categoryParam = url.searchParams.get("category");
  if (categoryParam) {
    if (!isNewsCategory(categoryParam)) {
      return ApiResponse.error({ code: "VALIDATION", message: `category must be one of: ${NEWS_CATEGORIES.join(", ")}` }, ctx.requestId, 400, ctx.startedAt);
    }
    category = categoryParam;
  }

  let provider: string | undefined;
  const providerParam = url.searchParams.get("provider");
  if (providerParam) {
    if (!KNOWN_PROVIDERS.includes(providerParam)) {
      return ApiResponse.error({ code: "VALIDATION", message: `provider must be one of: ${KNOWN_PROVIDERS.join(", ")}` }, ctx.requestId, 400, ctx.startedAt);
    }
    provider = providerParam;
  }

  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  const [{ items, total }, latestSuccessfulCallAt] = await Promise.all([
    queryNewsArticles({ symbols, category, provider }, { page, pageSize }),
    getLatestSuccessfulCallAt(),
  ]);

  const isStale = latestSuccessfulCallAt === null || Date.now() - latestSuccessfulCallAt.getTime() > staleThresholdMs();

  return ApiResponse.success(
    {
      items: items.map((a) => ({
        id: a.id,
        headline: a.headline,
        summary: a.summary,
        url: a.url,
        sourceName: a.sourceName,
        provider: a.provider,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        fetchedAt: a.fetchedAt.toISOString(),
        sentimentScore: a.sentimentScore,
        sentimentLabel: a.sentimentLabel,
        category: a.category,
        assetTags: a.assetTags,
        tagProvenance: a.tagProvenance,
        // impactLevel intentionally omitted - not shipped to the client yet (AN1.5 lock)
      })),
      total,
      page,
      pageSize,
      freshness: {
        latestFetchedAt: latestSuccessfulCallAt?.toISOString() ?? null,
        isStale,
      },
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
