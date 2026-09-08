// services/news/relevance.service.ts
// AN1.4 - deterministic-first asset relevance mapping, locked design:
//
//   native ticker match -> topic-derived -> keyword-inferred
//   -> optional AI enrichment (OFF, see AN1.5 lock) -> final assetTags
//
// Every tag carries its own provenance (method + confidence) so "why was
// this article shown for symbol X" is always answerable - never silently
// collapsed into a flat list. `confidence` represents the mapping METHOD's
// own confidence, not a statistically validated probability (explicit
// requirement - do not let this drift into looking like a validated score).
import { listEnabledMarkets } from "@/lib/market-data/market-registry";
import type { MarketSymbol } from "@/types/market";
import { NEWS_CATEGORIES, type NewsCategory } from "@/types/news-category";

export { NEWS_CATEGORIES, type NewsCategory };

export type TagMethod = "native_ticker" | "topic_derived" | "keyword_inferred" | "ai_enriched";

export interface AssetTag {
  symbol: MarketSymbol;
  method: TagMethod;
  confidence: number;
}

const CONFIDENCE_BY_METHOD: Record<TagMethod, number> = {
  native_ticker: 0.9, // provider itself identified this exact ticker as relevant
  topic_derived: 0.3, // coarse, asset-class-wide signal - many false positives expected
  keyword_inferred: 0.6, // a specific text match, more targeted than topic-derived
  ai_enriched: 0.5, // unused today - reserved for when AN1.5's AI step is ever turned on
};

// --- Step 2: deterministic provider-ticker -> AT24 symbol mapping ---------
// Alpha Vantage's real ticker format, confirmed via live test calls during
// AN1.5 (NOT the initially-assumed "FOREX:EURUSD" pair format):
//   FOREX:<currency-code>   e.g. "FOREX:USD" - a single currency, not a pair
//   CRYPTO:<asset-code>     e.g. "CRYPTO:BTC"
// A single currency maps to every AT24 pair that currency is a leg of.
const FOREX_CURRENCY_TO_SYMBOLS: Record<string, MarketSymbol[]> = {
  EUR: ["EURUSD"],
  GBP: ["GBPUSD"],
  JPY: ["USDJPY"],
  USD: ["EURUSD", "GBPUSD", "USDJPY"],
};

const CRYPTO_BASE_TO_SYMBOL: Record<string, MarketSymbol> = {
  BTC: "BTCUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  XRP: "XRPUSD",
};

/** CryptoPanic tags articles with plain currency codes (e.g. "BTC"), no provider prefix. */
export function mapCryptoPanicCurrency(code: string): MarketSymbol | null {
  return CRYPTO_BASE_TO_SYMBOL[code.toUpperCase()] ?? null;
}

/** Alpha Vantage's `ticker_sentiment[].ticker` value, e.g. "FOREX:USD", "CRYPTO:BTC", or a bare equity ticker (ignored - not in AT24's symbol universe). */
export function mapAlphaVantageTicker(ticker: string): MarketSymbol[] {
  const [prefix, code] = ticker.split(":");
  if (!code) return [];
  if (prefix === "FOREX") return FOREX_CURRENCY_TO_SYMBOLS[code.toUpperCase()] ?? [];
  if (prefix === "CRYPTO") {
    const symbol = CRYPTO_BASE_TO_SYMBOL[code.toUpperCase()];
    return symbol ? [symbol] : [];
  }
  return [];
}

// --- Step 3: deterministic topic -> forex/crypto mapping (coarse signal) -
// Real topics observed via a live Alpha Vantage test call (AN1.5): earnings,
// financial_markets, manufacturing, economy_macro, retail_wholesale,
// finance, energy_transportation, real_estate, technology, economy_monetary.
// Deliberately NOT exhaustive - Alpha Vantage's full topic taxonomy is
// broader; an unmapped topic simply contributes no tag (honest, not an
// error). Deliberately excludes commodities - macro/monetary topics are too
// coarse a signal for "this is about gold specifically"; XAU/XAG relies on
// the keyword step below instead.
//
// KNOWN ISSUE (found during AN1.7's real E2E smoke test, deliberately left
// unfixed by explicit decision - do not "clean this up" without that
// decision being revisited first): ingestAlphaVantage() queries by
// `topics=financial_markets,economy_macro` (services/news/ingestion.service.
// ts), and `financial_markets`/`economy_macro` are ALSO mapped to
// FOREX_MAJORS below - so every article this ingestion path fetches (by
// construction, since we queried FOR those topics) gets tagged with all
// three forex majors, regardless of actual content. A real test run against
// live data confirmed this empirically: 50/50 ingested articles (JPMorgan
// valuation, a Marriott earnings report, a utility-stock dividend piece -
// none genuinely forex-relevant) all received the identical assetTags:
// ["EURUSD","GBPUSD","USDJPY"], 100% via topic_derived, 0% via
// native_ticker or keyword_inferred. This is not "coarse but occasionally
// useful" as designed - for THIS ingestion pattern it is currently
// non-discriminative. Deliberately shipped as-is (AN1.7 scope freeze) - the
// real fix needs `assetTags`' own semantic contract settled first (is it
// "provenance of the fetch query" or "article relevance"?) before touching
// this mapping, per that decision.
const FOREX_MAJORS: MarketSymbol[] = ["EURUSD", "GBPUSD", "USDJPY"];
const CRYPTO_MAJORS: MarketSymbol[] = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];

const TOPIC_TO_SYMBOLS: Record<string, MarketSymbol[]> = {
  economy_macro: FOREX_MAJORS,
  economy_monetary: FOREX_MAJORS,
  financial_markets: FOREX_MAJORS,
  finance: FOREX_MAJORS,
  blockchain: CRYPTO_MAJORS,
};

// --- Step 4: XAU/XAG keyword inference ------------------------------------
// Alpha Vantage has no ticker for commodities at all (confirmed absence,
// not an oversight) - this is the one deterministic path Gold/Silver
// relevance can come from short of an AI call.
const KEYWORD_RULES: Array<{ pattern: RegExp; symbol: MarketSymbol }> = [
  { pattern: /\b(gold|xau)\b/i, symbol: "XAUUSD" },
  { pattern: /\b(silver|xag)\b/i, symbol: "XAGUSD" },
];

function keywordInferredSymbols(headline: string, summary: string | null): MarketSymbol[] {
  const text = `${headline} ${summary ?? ""}`;
  return KEYWORD_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.symbol);
}

// --- Step 5: optional AI enrichment - OFF, per AN1.5's explicit lock -----
// Not implemented. Kept as a named, documented no-op rather than silently
// absent, so a future sprint turning this on has one obvious place to wire
// it - never add AI tagging elsewhere in this pipeline.
function aiEnrichedSymbols(): MarketSymbol[] {
  return [];
}

export interface RelevanceInput {
  headline: string;
  summary: string | null;
  /** Alpha Vantage's `ticker_sentiment[].ticker` values, or CryptoPanic's currency codes - already provider-specific, mapped internally. */
  nativeTickers: string[];
  /** Alpha Vantage's `topics[].topic` values, when present. */
  topics: string[];
  provider: "alpha-vantage" | "cryptopanic";
}

/** Merges all four steps into final tags + provenance. When multiple steps tag the same symbol, the highest-confidence method wins (native ticker match beats a coarse topic guess for the same symbol). */
export function computeAssetTags(input: RelevanceInput): AssetTag[] {
  const bySymbol = new Map<MarketSymbol, AssetTag>();

  const upsert = (symbol: MarketSymbol, method: TagMethod) => {
    const existing = bySymbol.get(symbol);
    const confidence = CONFIDENCE_BY_METHOD[method];
    if (!existing || confidence > existing.confidence) {
      bySymbol.set(symbol, { symbol, method, confidence });
    }
  };

  const nativeSymbols =
    input.provider === "alpha-vantage"
      ? input.nativeTickers.flatMap(mapAlphaVantageTicker)
      : input.nativeTickers.map(mapCryptoPanicCurrency).filter((s): s is MarketSymbol => s !== null);
  nativeSymbols.forEach((s) => upsert(s, "native_ticker"));

  input.topics.flatMap((t) => TOPIC_TO_SYMBOLS[t] ?? []).forEach((s) => upsert(s, "topic_derived"));

  keywordInferredSymbols(input.headline, input.summary).forEach((s) => upsert(s, "keyword_inferred"));

  aiEnrichedSymbols().forEach((s) => upsert(s, "ai_enriched"));

  // Only ever tag symbols the platform actually knows about - a stray future
  // mapping-table typo can't smuggle an unknown symbol into the feed.
  const enabled = new Set(listEnabledMarkets().map((m) => m.symbol));
  return [...bySymbol.values()].filter((tag) => enabled.has(tag.symbol));
}

// --- Classification (AN1.5) - deterministic topic -> AT24 category -------
// Reuses the same real observed topic taxonomy. Deliberately NOT built from
// Alpha Vantage's own `category_within_source` field - confirmed via live
// testing to be uselessly generic ("General" on every sample).
// No "Other" bucket: classifyPrimaryCategory only ever returns one of
// NEWS_CATEGORIES or null ("unclassified") - an enum value the classifier
// can never actually produce would be dead code and a misleading filter
// option. (NEWS_CATEGORIES/NewsCategory now live in types/news-category.ts
// - re-exported above - since the client-side filter UI needs them too and
// this file is server-only.)
const TOPIC_TO_CATEGORY: Record<string, NewsCategory> = {
  economy_monetary: "Monetary Policy",
  economy_macro: "Economic Data",
  financial_markets: "Economic Data",
  finance: "Economic Data",
  real_estate: "Economic Data",
  manufacturing: "Economic Data",
  retail_wholesale: "Corporate",
  earnings: "Corporate",
  technology: "Corporate",
  energy_transportation: "Commodities",
  blockchain: "Crypto",
};

/** Picks the primary category from the highest-relevance topic Alpha Vantage returned for this article; null when no known topic mapped (honest "unclassified", never forced into "Other" by default). */
export function classifyPrimaryCategory(topicsByRelevance: Array<{ topic: string; relevanceScore: number }>): NewsCategory | null {
  const sorted = [...topicsByRelevance].sort((a, b) => b.relevanceScore - a.relevanceScore);
  for (const { topic } of sorted) {
    const category = TOPIC_TO_CATEGORY[topic];
    if (category) return category;
  }
  return null;
}
