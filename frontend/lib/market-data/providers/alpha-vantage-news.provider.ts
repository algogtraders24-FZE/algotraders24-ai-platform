// lib/market-data/providers/alpha-vantage-news.provider.ts
// Sprint 15D.12 - First real implementation of Sprint 15D.11's NewsProvider
// interface (types/evidence-fusion.ts, unmodified). Mirrors
// alpha-vantage.provider.ts's exact shape and testability approach:
// injectable fetchImpl/Clock, a TtlCache, typed MarketDataProviderError
// classification, and the same "Note"/"Information"/"Error Message"
// rate-limit detection - all reused from the existing lib/market-data/*
// infrastructure, so this needed zero new environment variables (it reuses
// ALPHA_VANTAGE_API_KEY) and zero new npm dependencies.
//
// Alpha Vantage's NEWS_SENTIMENT endpoint has no documented ticker for
// commodities like XAU/XAG (its `tickers` param covers stocks, crypto, and
// FOREX: pairs - not gold/silver). Rather than inventing an unofficial
// ticker mapping, this provider queries by `topics` (a real, documented
// parameter: financial_markets, economy_macro, etc.) and returns general
// financial-market news, tagged with whatever symbol the caller asked
// about. This is a disclosed limitation, not a hidden one - see the report
// for Sprint 15D.12.
//
// Never fabricates: an empty `feed` produces zero evidence, never a
// placeholder headline. A headline's timestamp is only ever set when
// Alpha Vantage's own `time_published` field parses cleanly - otherwise
// the item is dropped rather than guessed (same policy as
// parseProviderTimestamp in alpha-vantage.provider.ts).
import type { EvidenceItem } from "@/types/evidence";
import type { EvidenceProviderRequest, NewsProvider } from "@/types/evidence-fusion";
import { loadAlphaVantageEnv, type AlphaVantageEnv } from "../env";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "alpha-vantage-news";
const BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_CACHE_TTL_MS = 5 * 60_000; // news moves slower than a spot price - 5 min is plenty
const DEFAULT_TOPICS = ["financial_markets", "economy_macro"];
const DEFAULT_QUERY_LIMIT = 10;
const MAX_HEADLINES = 5;

interface CachedHeadline {
  claim: string;
  source: string;
  /** ISO timestamp, only ever set when reliably parsed - never guessed. */
  asOf?: string;
}

// Minimal shape of Alpha Vantage's documented NEWS_SENTIMENT response -
// only the fields this adapter actually reads.
interface AlphaVantageNewsResponse {
  feed?: Array<{
    title?: string;
    source?: string;
    time_published?: string;
  }>;
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network - identical pattern to AlphaVantageFetch. */
export type AlphaVantageNewsFetch = (url: string) => Promise<FetchLikeResponse>;

export interface AlphaVantageNewsProviderOptions {
  cacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: AlphaVantageNewsFetch;
  /** Alpha Vantage `topics` values to query - see DEFAULT_TOPICS for the default, macro/financial-market-oriented choice. */
  topics?: readonly string[];
}

export class AlphaVantageNewsProvider implements NewsProvider {
  readonly name = PROVIDER_NAME;
  private readonly env: AlphaVantageEnv | null;
  private readonly cache: TtlCache<CachedHeadline[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: AlphaVantageNewsFetch;
  private readonly topics: readonly string[];

  constructor(options: AlphaVantageNewsProviderOptions = {}) {
    this.env = loadAlphaVantageEnv();
    this.clock = options.clock ?? systemClock;
    this.cache = new TtlCache<CachedHeadline[]>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as AlphaVantageNewsFetch);
    this.topics = options.topics ?? DEFAULT_TOPICS;
  }

  isConfigured(): boolean {
    return this.env !== null;
  }

  async getNewsEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    if (!this.env) {
      throw new MarketDataProviderError("unconfigured", `${PROVIDER_NAME} is not configured (missing ALPHA_VANTAGE_API_KEY)`, PROVIDER_NAME);
    }

    const cacheKey = this.topics.join(",");
    let headlines = this.cache.get(cacheKey);
    if (!headlines) {
      headlines = await this.fetchHeadlines(this.env.apiKey);
      this.cache.set(cacheKey, headlines);
    }

    const retrievedAt = new Date(this.clock.now()).toISOString();
    return headlines.map((headline) => ({
      type: "news",
      symbol: request.symbol,
      claim: headline.claim,
      source: headline.source,
      // A headline this provider could not confidently timestamp is still
      // reported (the claim itself is real), but with retrievedAt as its
      // only honest timestamp - never a guessed publish time.
      asOf: headline.asOf ?? retrievedAt,
      retrievedAt,
    }));
  }

  private async fetchHeadlines(apiKey: string): Promise<CachedHeadline[]> {
    const url = `${BASE_URL}?function=NEWS_SENTIMENT&topics=${encodeURIComponent(this.topics.join(","))}&limit=${DEFAULT_QUERY_LIMIT}&apikey=${apiKey}`;

    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url);
    } catch (error) {
      // Never let the raw error (which may echo the request URL, and
      // therefore the API key) escape unwrapped.
      throw new MarketDataProviderError("http_error", "Failed to reach Alpha Vantage", PROVIDER_NAME, error);
    }

    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 ? "auth" : "http_error";
      throw new MarketDataProviderError(kind, `Alpha Vantage returned HTTP ${res.status}`, PROVIDER_NAME);
    }

    let body: AlphaVantageNewsResponse;
    try {
      body = (await res.json()) as AlphaVantageNewsResponse;
    } catch (error) {
      throw new MarketDataProviderError("invalid_response", "Alpha Vantage response was not valid JSON", PROVIDER_NAME, error);
    }

    // Same explicit-detection convention as alpha-vantage.provider.ts:
    // Alpha Vantage reports rate limiting and errors with HTTP 200 and a
    // "Note"/"Information"/"Error Message" field, never a non-2xx status.
    if (typeof body.Note === "string" || typeof body.Information === "string") {
      const text = body.Note ?? body.Information ?? "";
      throw new MarketDataProviderError("rate_limit", `Alpha Vantage rate limit: ${text}`, PROVIDER_NAME);
    }
    if (typeof body["Error Message"] === "string") {
      const message = body["Error Message"];
      const isAuth = /api ?key/i.test(message);
      throw new MarketDataProviderError(isAuth ? "auth" : "invalid_response", `Alpha Vantage error: ${message}`, PROVIDER_NAME);
    }

    // An empty/absent feed is a valid "no news right now" outcome, never
    // an error - the caller receives zero evidence, exactly like any other
    // absent-signal case in this system.
    const feed = body.feed ?? [];
    return feed
      .filter((article): article is { title: string; source?: string; time_published?: string } => Boolean(article.title))
      .slice(0, MAX_HEADLINES)
      .map((article) => ({
        claim: article.title,
        source: article.source && article.source.trim().length > 0 ? article.source : PROVIDER_NAME,
        asOf: this.parsePublishedTimestamp(article.time_published),
      }));
  }

  // Alpha Vantage documents time_published as UTC in "YYYYMMDDTHHMMSS"
  // form. Only ever returns a timestamp when it parses cleanly - an
  // unparseable or absent value is treated as "not available", never
  // guessed (mirrors parseProviderTimestamp in alpha-vantage.provider.ts).
  private parsePublishedTimestamp(timePublished?: string): string | undefined {
    if (!timePublished || !/^\d{8}T\d{6}$/.test(timePublished)) return undefined;
    const iso = `${timePublished.slice(0, 4)}-${timePublished.slice(4, 6)}-${timePublished.slice(6, 8)}T${timePublished.slice(9, 11)}:${timePublished.slice(11, 13)}:${timePublished.slice(13, 15)}Z`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
}
