// services/news/normalize.service.ts
// AN1.3/AN1.4/AN1.5 - maps each provider's raw shape into the provider-
// independent NewsArticle contract. Sentiment/relevance are preserved
// exactly as the provider returned them (never normalized/rewritten -
// AN1.5's explicit lock); category/assetTags/tagProvenance are AT24's own
// derived fields, kept structurally separate.
import "server-only";
import { createHash } from "crypto";
import { computeAssetTags, classifyPrimaryCategory, mapAlphaVantageTicker } from "./relevance.service";
import { ALPHA_VANTAGE_PROVIDER, type RawAlphaVantageArticle } from "./providers/alpha-vantage.provider";
import { CRYPTOPANIC_PROVIDER, type RawCryptoPanicArticle } from "./providers/cryptopanic.provider";

export interface NormalizedNewsArticle {
  provider: string;
  providerArticleId: string | null;
  dedupeKey: string;
  headline: string;
  summary: string | null;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  relevanceByAsset: Record<string, number> | null;
  category: string | null;
  assetTags: string[];
  tagProvenance: Record<string, { method: string; confidence: number }> | null;
  rawPayload: unknown;
}

/** Canonical identity for dedup: the article's own url when present (a real article never has two different urls); otherwise a deterministic hash of provider+source+headline+publishedAt - stable across repeated ingestion runs for the same real article, never random. */
function computeDedupeKey(provider: string, url: string | null, headline: string, source: string | null, publishedAt: string | null): string {
  if (url) return url;
  const basis = `${provider}|${source ?? ""}|${headline}|${publishedAt ?? ""}`;
  return createHash("sha256").update(basis).digest("hex");
}

function toProvenanceAndAssetTags(tags: ReturnType<typeof computeAssetTags>) {
  const assetTags = tags.map((t) => t.symbol);
  const tagProvenance: Record<string, { method: string; confidence: number }> = {};
  for (const tag of tags) tagProvenance[tag.symbol] = { method: tag.method, confidence: tag.confidence };
  return { assetTags, tagProvenance: Object.keys(tagProvenance).length > 0 ? tagProvenance : null };
}

export function normalizeAlphaVantageArticle(raw: RawAlphaVantageArticle): NormalizedNewsArticle {
  const tags = computeAssetTags({
    headline: raw.title,
    summary: raw.summary,
    nativeTickers: raw.tickerSentiment.map((t) => t.ticker),
    topics: raw.topics.map((t) => t.topic),
    provider: "alpha-vantage",
  });
  const { assetTags, tagProvenance } = toProvenanceAndAssetTags(tags);

  // Provider-native per-ticker relevance, keyed by AT24 symbol (not the raw
  // provider ticker string) so API consumers never need to know Alpha
  // Vantage's own ticker syntax.
  const relevanceByAsset: Record<string, number> = {};
  for (const ts of raw.tickerSentiment) {
    for (const symbol of mapAlphaVantageTicker(ts.ticker)) {
      relevanceByAsset[symbol] = ts.relevanceScore;
    }
  }

  const category = classifyPrimaryCategory(raw.topics.map((t) => ({ topic: t.topic, relevanceScore: t.relevanceScore })));

  return {
    provider: ALPHA_VANTAGE_PROVIDER,
    providerArticleId: null, // Alpha Vantage has no stable native article id
    dedupeKey: computeDedupeKey(ALPHA_VANTAGE_PROVIDER, raw.url, raw.title, raw.source, raw.publishedAt),
    headline: raw.title,
    summary: raw.summary,
    url: raw.url,
    sourceName: raw.source,
    publishedAt: raw.publishedAt,
    sentimentScore: raw.overallSentimentScore,
    sentimentLabel: raw.overallSentimentLabel,
    relevanceByAsset: Object.keys(relevanceByAsset).length > 0 ? relevanceByAsset : null,
    category,
    assetTags,
    tagProvenance,
    rawPayload: raw,
  };
}

export function normalizeCryptoPanicArticle(raw: RawCryptoPanicArticle): NormalizedNewsArticle {
  // CryptoPanic explicitly tags articles with the currencies they concern -
  // that's a native ticker match by definition, same confidence tier as
  // Alpha Vantage's ticker_sentiment.
  const tags = computeAssetTags({
    headline: raw.title,
    summary: null,
    nativeTickers: raw.currencyCodes,
    topics: [],
    provider: "cryptopanic",
  });
  const { assetTags, tagProvenance } = toProvenanceAndAssetTags(tags);

  return {
    provider: CRYPTOPANIC_PROVIDER,
    providerArticleId: raw.id || null,
    dedupeKey: computeDedupeKey(CRYPTOPANIC_PROVIDER, raw.url, raw.title, raw.source, raw.publishedAt),
    headline: raw.title,
    summary: null, // CryptoPanic posts have no separate summary field
    url: raw.url,
    sourceName: raw.source,
    publishedAt: raw.publishedAt,
    // CryptoPanic has no numeric sentiment score - `kind` is a coarse label,
    // not a validated equivalent to Alpha Vantage's scale, so it's kept out
    // of sentimentScore/Label entirely rather than force-mapped.
    sentimentScore: null,
    sentimentLabel: null,
    relevanceByAsset: null,
    category: null, // no topic taxonomy to classify from
    assetTags,
    tagProvenance,
    rawPayload: raw,
  };
}
