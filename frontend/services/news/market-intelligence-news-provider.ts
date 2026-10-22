// services/news/market-intelligence-news-provider.ts
// AN1.2 - the approved "cache-first" NewsProvider for Market Intelligence,
// reading the shared NewsArticle store instead of calling Alpha Vantage
// directly on every analysis request. Deliberately a NEW, separate class
// from lib/market-data/providers/alpha-vantage-news.provider.ts (the
// pre-existing implementation, unchanged) rather than a rewrite of it: that
// class has an extensive test suite (scripts/validate-alpha-vantage-news-
// provider.ts, 21 assertions) built around direct fetchImpl injection with
// zero DB dependency - rerouting its internals through Postgres would
// silently break that suite's whole "no real network/DB call" testing
// strategy. This class is what gets wired into the live analyze route
// instead; the old class and its tests remain valid, untouched, still
// passing - just no longer the one used in production.
import "server-only";
import type { EvidenceItem } from "@/types/evidence";
import type { EvidenceProviderRequest, NewsProvider } from "@/types/evidence-fusion";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { loadAlphaVantageEnv } from "@/lib/market-data/env";
import { getLatestSuccessfulCallAt } from "./quota.service";
import { getStoredArticlesBySymbol } from "./store.service";
import { ingestAlphaVantage, ingestMarketaux } from "./ingestion.service";
import { loadMarketauxEnv, staleThresholdMs } from "./config";

const PROVIDER_NAME = "shared-news-cache";
const MAX_HEADLINES = 5;

export class SharedNewsCacheProvider implements NewsProvider {
  readonly name = PROVIDER_NAME;

  /** `refresh: false` = read the stored articles only and never trigger a live Alpha Vantage refresh (used by the real-time path, which can analyse several symbols at once; the daily ingest-news cron keeps the store fresh). Default true: unchanged behaviour. */
  constructor(private readonly options: { refresh?: boolean } = {}) {}

  isConfigured(): boolean {
    return loadMarketauxEnv() !== null || loadAlphaVantageEnv() !== null;
  }

  async getNewsEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    if (!this.isConfigured()) {
      throw new MarketDataProviderError("unconfigured", `${PROVIDER_NAME} is not configured (missing MARKETAUX_API_TOKEN and ALPHA_VANTAGE_API_KEY)`, PROVIDER_NAME);
    }

    // Freshness is judged across ALL providers: whichever one is working keeps the store current.
    const latestCall = await getLatestSuccessfulCallAt();
    const isFresh = latestCall !== null && Date.now() - latestCall.getTime() <= staleThresholdMs();

    if (!isFresh && this.options.refresh !== false) {
      // Best-effort quota-reserved refresh - ingestAlphaVantage never
      // throws (it catches internally and returns a result object), so a
      // failed/quota-exhausted refresh just falls through to whatever is
      // already stored below, even if stale. An analysis with slightly
      // stale news evidence is real and honest; a hard failure here would
      // not be - matches the existing pipeline's "news is best-effort,
      // never fatal" contract (validated by the old suite's tests 19-21).
      await ingestMarketaux("on-demand-fallback");
      await ingestAlphaVantage("on-demand-fallback");
    }

    const articles = await getStoredArticlesBySymbol(undefined, request.symbol, MAX_HEADLINES);
    const retrievedAt = new Date().toISOString();

    return articles.map((article) => ({
      type: "news" as const,
      symbol: request.symbol,
      claim: article.headline,
      source: article.sourceName && article.sourceName.trim().length > 0 ? article.sourceName : PROVIDER_NAME,
      // The article's own real publish time when known; retrievedAt is the
      // only honest fallback otherwise - never a guessed publish time,
      // same discipline as the class this replaces in production.
      asOf: article.publishedAt?.toISOString() ?? retrievedAt,
      retrievedAt,
    }));
  }
}
