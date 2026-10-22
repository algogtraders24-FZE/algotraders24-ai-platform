// services/news/providers/marketaux.provider.ts
// Marketaux (api.marketaux.com) news provider. Empirically verified with a real key on 2026-10-22 (free plan: 100 requests/day, 30/minute,
// 3 articles per request):
//   - one call per symbol: `symbols=EURUSD` returns articles whose `entities[]` carry a per-entity `sentiment_score` (-1..+1);
//   - EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD are real Marketaux entities with fresh articles;
//   - XAUUSD / XAGUSD are NOT Marketaux entities (0 results) - Gold/Silver get no articles from this provider, honestly;
//   - the token travels as a query parameter, so no error path may echo the request URL.
// Replaces Alpha Vantage as the working source after Alpha Vantage moved NEWS_SENTIMENT behind a premium plan (every call since 2026-10-06 returns "premium endpoint").
import "server-only";
import { loadMarketauxEnv } from "@/services/news/config";
import { MarketDataProviderError } from "@/lib/market-data/errors";

const BASE_URL = "https://api.marketaux.com/v1/news/all";
export const MARKETAUX_PROVIDER = "marketaux";

/** AT24 symbols Marketaux covers as entities (verified live). Each is one request, so the daily budget is symbols x runs. */
export const MARKETAUX_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD"] as const;

export interface RawMarketauxEntity {
  symbol: string;
  type: string | null;
  sentimentScore: number | null;
}

export interface RawMarketauxArticle {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  entities: RawMarketauxEntity[];
}

interface MarketauxEntity {
  symbol?: string;
  type?: string;
  sentiment_score?: number | null;
}

interface MarketauxArticle {
  uuid?: string;
  title?: string;
  description?: string | null;
  url?: string | null;
  source?: string | null;
  published_at?: string | null;
  entities?: MarketauxEntity[];
}

interface MarketauxResponse {
  data?: MarketauxArticle[];
  error?: { code?: string; message?: string };
}

function nonEmpty(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** Marketaux wants `YYYY-MM-DDTHH:mm` (UTC). */
function formatAfter(date: Date): string {
  return date.toISOString().slice(0, 16);
}

/**
 * Fetches the newest articles tagged with one AT24 symbol. Throws MarketDataProviderError on any failure (the ingestion service reserves
 * quota before calling and logs the outcome). Never lets an error carry the request URL (it contains the token).
 */
export async function fetchMarketauxNews(symbol: string, publishedAfter: Date): Promise<RawMarketauxArticle[]> {
  const env = loadMarketauxEnv();
  if (!env) {
    throw new MarketDataProviderError("unconfigured", `${MARKETAUX_PROVIDER} is not configured (missing MARKETAUX_API_TOKEN)`, MARKETAUX_PROVIDER);
  }

  const params = new URLSearchParams({
    api_token: env.apiToken,
    symbols: symbol,
    language: "en",
    published_after: formatAfter(publishedAfter),
    sort: "published_at",
  });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}?${params.toString()}`, { headers: { "User-Agent": "algotraders24-news-ingestion" } });
  } catch (error) {
    throw new MarketDataProviderError("http_error", "Failed to reach Marketaux", MARKETAUX_PROVIDER, error);
  }

  if (!res.ok) {
    let code = "";
    try {
      code = ((await res.json()) as MarketauxResponse).error?.code ?? "";
    } catch {
      // body is not JSON - the status alone decides
    }
    const kind = res.status === 401 || code === "invalid_api_token" || code === "endpoint_access_restricted" ? "auth" : res.status === 402 || res.status === 429 ? "rate_limit" : "http_error";
    throw new MarketDataProviderError(kind, `Marketaux returned HTTP ${res.status}${code ? ` (${code})` : ""}`, MARKETAUX_PROVIDER);
  }

  let body: MarketauxResponse;
  try {
    body = (await res.json()) as MarketauxResponse;
  } catch (error) {
    throw new MarketDataProviderError("invalid_response", "Marketaux response was not valid JSON", MARKETAUX_PROVIDER, error);
  }

  return (body.data ?? [])
    .filter((a): a is MarketauxArticle & { title: string; uuid: string } => Boolean(a.title) && Boolean(a.uuid))
    .map((a) => ({
      id: a.uuid,
      title: a.title,
      description: nonEmpty(a.description),
      url: nonEmpty(a.url),
      source: nonEmpty(a.source),
      publishedAt: a.published_at ?? null,
      entities: (a.entities ?? [])
        .filter((e): e is MarketauxEntity & { symbol: string } => Boolean(e.symbol))
        .map((e) => ({ symbol: e.symbol, type: e.type ?? null, sentimentScore: typeof e.sentiment_score === "number" ? e.sentiment_score : null })),
    }));
}
