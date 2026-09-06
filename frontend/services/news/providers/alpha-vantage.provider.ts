// services/news/providers/alpha-vantage.provider.ts
// AN1 - the ONE real HTTP-calling function for Alpha Vantage's
// NEWS_SENTIMENT endpoint, shared by the ingestion cron job and Market
// Intelligence's cache-first fallback (AN1.2's explicit "one controlled
// ingestion layer, not two independent fetchers" requirement). Field shapes
// below are grounded in real, live test calls made during AN1.5 design
// (topics=economy_macro, tickers=FOREX:USD / CRYPTO:BTC) - not guessed from
// documentation summaries. Distinct from lib/market-data/providers/
// alpha-vantage-news.provider.ts (the pre-existing, narrower adapter Market
// Intelligence's evidence-fusion pipeline calls) - that one is being
// migrated to read through this shared path rather than duplicate it.
import "server-only";
import { loadAlphaVantageEnv } from "@/lib/market-data/env";
import { MarketDataProviderError } from "@/lib/market-data/errors";

const BASE_URL = "https://www.alphavantage.co/query";
export const ALPHA_VANTAGE_PROVIDER = "alpha-vantage";

export interface RawAlphaVantageArticle {
  title: string;
  url: string | null;
  summary: string | null;
  source: string | null;
  /** Only ever set when Alpha Vantage's own time_published parses cleanly - never guessed. */
  publishedAt: string | null;
  overallSentimentScore: number | null;
  /** Preserved EXACTLY as returned (e.g. "Somewhat-Bullish", hyphenated) - never normalized. */
  overallSentimentLabel: string | null;
  tickerSentiment: Array<{ ticker: string; relevanceScore: number; sentimentScore: number; sentimentLabel: string }>;
  topics: Array<{ topic: string; relevanceScore: number }>;
}

interface AlphaVantageFeedItem {
  title?: string;
  url?: string;
  summary?: string;
  source?: string;
  time_published?: string;
  overall_sentiment_score?: number;
  overall_sentiment_label?: string;
  ticker_sentiment?: Array<{ ticker?: string; relevance_score?: string; ticker_sentiment_score?: string; ticker_sentiment_label?: string }>;
  topics?: Array<{ topic?: string; relevance_score?: string }>;
}

interface AlphaVantageResponse {
  feed?: AlphaVantageFeedItem[];
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

// Alpha Vantage documents time_published as UTC "YYYYMMDDTHHMMSS" - only
// ever returns a timestamp when it parses cleanly, mirroring the existing
// alpha-vantage.provider.ts convention elsewhere in this codebase.
function parsePublishedAt(timePublished?: string): string | null {
  if (!timePublished || !/^\d{8}T\d{6}$/.test(timePublished)) return null;
  const iso = `${timePublished.slice(0, 4)}-${timePublished.slice(4, 6)}-${timePublished.slice(6, 8)}T${timePublished.slice(9, 11)}:${timePublished.slice(11, 13)}:${timePublished.slice(13, 15)}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetches Alpha Vantage's NEWS_SENTIMENT by topic (never per-symbol - one
 * call already returns general market news covering everything; querying
 * per-symbol would multiply real quota usage for no benefit, since
 * `ticker_sentiment` is present on every article regardless of whether
 * `tickers` was specified - confirmed via a live test call during AN1.5).
 * Throws MarketDataProviderError on any failure - the caller (ingestion
 * service) is responsible for quota reservation before calling this, and
 * for logging the outcome.
 */
export async function fetchAlphaVantageNews(topics: readonly string[], limit = 50): Promise<RawAlphaVantageArticle[]> {
  const env = loadAlphaVantageEnv();
  if (!env) {
    throw new MarketDataProviderError("unconfigured", `${ALPHA_VANTAGE_PROVIDER} is not configured (missing ALPHA_VANTAGE_API_KEY)`, ALPHA_VANTAGE_PROVIDER);
  }

  const url = `${BASE_URL}?function=NEWS_SENTIMENT&topics=${encodeURIComponent(topics.join(","))}&limit=${limit}&apikey=${env.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    // Never let the raw error (which may echo the request URL, and
    // therefore the API key) escape unwrapped.
    throw new MarketDataProviderError("http_error", "Failed to reach Alpha Vantage", ALPHA_VANTAGE_PROVIDER, error);
  }

  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? "auth" : "http_error";
    throw new MarketDataProviderError(kind, `Alpha Vantage returned HTTP ${res.status}`, ALPHA_VANTAGE_PROVIDER);
  }

  let body: AlphaVantageResponse;
  try {
    body = (await res.json()) as AlphaVantageResponse;
  } catch (error) {
    throw new MarketDataProviderError("invalid_response", "Alpha Vantage response was not valid JSON", ALPHA_VANTAGE_PROVIDER, error);
  }

  // Alpha Vantage reports rate limiting and invalid-input errors with HTTP
  // 200 and a "Note"/"Information"/"Error Message" field, never a non-2xx
  // status - confirmed directly via a live rate-limited test call.
  if (typeof body.Note === "string" || typeof body.Information === "string") {
    throw new MarketDataProviderError("rate_limit", `Alpha Vantage rate limit: ${body.Note ?? body.Information}`, ALPHA_VANTAGE_PROVIDER);
  }
  if (typeof body["Error Message"] === "string") {
    const isAuth = /api ?key/i.test(body["Error Message"]);
    throw new MarketDataProviderError(isAuth ? "auth" : "invalid_response", `Alpha Vantage error: ${body["Error Message"]}`, ALPHA_VANTAGE_PROVIDER);
  }

  const feed = body.feed ?? [];
  return feed
    .filter((item): item is AlphaVantageFeedItem & { title: string } => Boolean(item.title))
    .map((item) => ({
      title: item.title,
      url: item.url && item.url.trim().length > 0 ? item.url : null,
      summary: item.summary && item.summary.trim().length > 0 ? item.summary : null,
      source: item.source && item.source.trim().length > 0 ? item.source : null,
      publishedAt: parsePublishedAt(item.time_published),
      overallSentimentScore: item.overall_sentiment_score ?? null,
      overallSentimentLabel: item.overall_sentiment_label ?? null,
      tickerSentiment: (item.ticker_sentiment ?? [])
        .filter((t): t is Required<typeof t> => Boolean(t.ticker))
        .map((t) => ({
          ticker: t.ticker,
          relevanceScore: toNumber(t.relevance_score) ?? 0,
          sentimentScore: toNumber(t.ticker_sentiment_score) ?? 0,
          sentimentLabel: t.ticker_sentiment_label ?? "",
        })),
      topics: (item.topics ?? [])
        .filter((t): t is Required<typeof t> => Boolean(t.topic))
        .map((t) => ({ topic: t.topic, relevanceScore: toNumber(t.relevance_score) ?? 0 })),
    }));
}
