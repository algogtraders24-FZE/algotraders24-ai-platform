// services/evidence-sources/stored-news-provider.ts
// "news" evidence for the real-time Market Intelligence path: the headlines
// already stored by the daily news ingestion (shared NewsArticle store), read-only.
// Unlike the analyze route's provider it never triggers a live Alpha Vantage
// refresh - this path can analyse several symbols at once, and the daily
// ingest-news cron is what keeps the store fresh. No stored headlines = no news
// evidence (an honest absence).
//
// The store-backed provider is server-only, so it is resolved lazily at call time;
// that keeps this module loadable from plain scripts and tests.

import type { EvidenceItem } from "@/types/evidence";
import type { EvidenceProviderRequest, NewsProvider } from "@/types/evidence-fusion";
import { loadAlphaVantageEnv } from "@/lib/market-data/env";

/** One source name for every stored headline (the publisher moves into the claim). The ranking stage flags two same-type items from DIFFERENT sources with different text as a conflict; distinct headlines from distinct publishers are not competing claims, so under per-publisher source names N headlines produced N(N-1)/2 spurious "conflicts" (10 for 5 headlines) and pushed every symbol's risk to High. */
export const STORED_NEWS_SOURCE = "AT24 stored news";

export class StoredNewsEvidenceProvider implements NewsProvider {
  readonly name = "stored-news-evidence";

  constructor(private readonly load: () => Promise<NewsProvider> = defaultLoad) {}

  isConfigured(): boolean {
    return loadAlphaVantageEnv() !== null;
  }

  async getNewsEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    const items = await (await this.load()).getNewsEvidence(request);
    return items.map((i) => ({ ...i, claim: i.source && i.source !== STORED_NEWS_SOURCE ? `${i.claim} (${i.source})` : i.claim, source: STORED_NEWS_SOURCE }));
  }
}

async function defaultLoad(): Promise<NewsProvider> {
  const { SharedNewsCacheProvider } = await import("@/services/news/market-intelligence-news-provider");
  return new SharedNewsCacheProvider({ refresh: false });
}
