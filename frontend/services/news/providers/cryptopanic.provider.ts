// services/news/providers/cryptopanic.provider.ts
// AN1 - CryptoPanic secondary provider (approved, AN1.6). UNLIKE the Alpha
// Vantage adapter in this same directory, this has NOT been empirically
// verified against a real API response - CryptoPanic requires a real
// account/API token to call, which is an account-creation action outside
// what this implementation is permitted to do on its own. Research (public
// SDK docs, not a live test call) suggests posts carry `currencies` or
// `instruments` (sources disagree - CryptoPanic has a v1/v2 API split and
// documentation is inconsistent) with a `code` per entry; `kind`/`votes`
// approximate sentiment rather than a numeric score like Alpha Vantage's.
//
// DO NOT ENABLE IN PRODUCTION until someone with a real CRYPTOPANIC_AUTH_
// TOKEN runs a real test call and confirms/corrects the field mapping below
// - mirroring exactly how the Alpha Vantage ticker format was corrected
// during AN1.5 after a real test call, not left as an assumption.
import "server-only";
import { loadCryptoPanicEnv } from "@/services/news/config";
import { MarketDataProviderError } from "@/lib/market-data/errors";

const BASE_URL = "https://cryptopanic.com/api/v1/posts/";
export const CRYPTOPANIC_PROVIDER = "cryptopanic";

export interface RawCryptoPanicArticle {
  id: string;
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  /** Currency codes this post is tagged with, e.g. ["BTC"] - field name unverified, see header. */
  currencyCodes: string[];
  /** CryptoPanic has no numeric sentiment score - `kind` ("positive"/"negative"/"important"/etc, unverified exact vocabulary) is the closest signal. */
  kind: string | null;
}

interface CryptoPanicPost {
  id?: number | string;
  title?: string;
  url?: string;
  original_url?: string;
  source?: { title?: string; domain?: string };
  published_at?: string;
  created_at?: string;
  currencies?: Array<{ code?: string }>;
  instruments?: Array<{ code?: string }>;
  kind?: string;
}

interface CryptoPanicResponse {
  results?: CryptoPanicPost[];
}

/**
 * Fetches CryptoPanic's post feed for the given currency codes. Returns []
 * (never throws) when unconfigured - CryptoPanic is an optional secondary
 * provider; its absence must never block Alpha Vantage's real, primary
 * ingestion. Throws MarketDataProviderError only for a genuine call failure
 * once configured, matching the Alpha Vantage adapter's error contract.
 */
export async function fetchCryptoPanicNews(currencyCodes: readonly string[]): Promise<RawCryptoPanicArticle[]> {
  const env = loadCryptoPanicEnv();
  if (!env) return [];

  const url = `${BASE_URL}?auth_token=${env.authToken}&currencies=${encodeURIComponent(currencyCodes.join(","))}&kind=news`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new MarketDataProviderError("http_error", "Failed to reach CryptoPanic", CRYPTOPANIC_PROVIDER, error);
  }

  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? "auth" : "http_error";
    throw new MarketDataProviderError(kind, `CryptoPanic returned HTTP ${res.status}`, CRYPTOPANIC_PROVIDER);
  }

  let body: CryptoPanicResponse;
  try {
    body = (await res.json()) as CryptoPanicResponse;
  } catch (error) {
    throw new MarketDataProviderError("invalid_response", "CryptoPanic response was not valid JSON", CRYPTOPANIC_PROVIDER, error);
  }

  return (body.results ?? [])
    .filter((p): p is CryptoPanicPost & { title: string } => Boolean(p.title))
    .map((p) => ({
      id: String(p.id ?? ""),
      title: p.title,
      url: p.original_url ?? p.url ?? null,
      source: p.source?.title ?? p.source?.domain ?? null,
      publishedAt: p.published_at ?? p.created_at ?? null,
      currencyCodes: (p.currencies ?? p.instruments ?? [])
        .map((c) => c.code)
        .filter((c): c is string => Boolean(c)),
      kind: p.kind ?? null,
    }));
}
