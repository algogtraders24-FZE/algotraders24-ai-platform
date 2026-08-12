// services/market-data/discovery/alpha-vantage-instrument-discovery.service.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Alpha Vantage's real, documented public endpoint GET
// https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=<q>
// &apikey=<key> - reuses the exact configured ALPHA_VANTAGE_API_KEY
// alpha-vantage.provider.ts already loads server-side via
// loadAlphaVantageEnv(). Never a second key, never exposed to the browser.
//
// Discovery-only, same reasoning as the Twelve Data discovery service:
// alpha-vantage.provider.ts's own SYMBOL_MAP is explicitly frozen to
// CURRENCY_EXCHANGE_RATE-servable forex/metals codes (EURUSD/XAUUSD/
// XAGUSD) - SYMBOL_SEARCH itself is an equities/company-name search, an
// asset class this platform's Alpha Vantage adapter has never served at
// all. A discovered candidate here is real, findable metadata, never a
// live market-data capability claim this adapter cannot back up.
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import { loadAlphaVantageEnv } from "@/lib/market-data/env";
import type { DiscoveredCandidate, ProviderDiscoveryResult } from "@/types/instrument-discovery";

const PROVIDER_NAME = "alpha-vantage";
const SYMBOL_SEARCH_URL = "https://www.alphavantage.co/query";
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_STALE_MAX_AGE_MS = 60 * 60_000;
const MAX_RESULTS = 20;

interface AlphaVantageSymbolMatch {
  "1. symbol"?: string;
  "2. name"?: string;
  "3. type"?: string;
  "4. region"?: string;
  "8. currency"?: string;
}
interface AlphaVantageSymbolSearchResponse {
  bestMatches?: AlphaVantageSymbolMatch[];
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}
interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type AlphaVantageDiscoveryFetch = (url: string) => Promise<FetchLikeResponse>;

export interface AlphaVantageInstrumentDiscoveryOptions {
  cacheTtlMs?: number;
  staleMaxAgeMs?: number;
  clock?: Clock;
  fetchImpl?: AlphaVantageDiscoveryFetch;
}

export class AlphaVantageInstrumentDiscoveryService {
  readonly name = PROVIDER_NAME;
  private readonly cache: TtlCache<AlphaVantageSymbolMatch[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: AlphaVantageDiscoveryFetch;
  private readonly cacheTtlMs: number;
  private readonly staleMaxAgeMs: number;

  constructor(options: AlphaVantageInstrumentDiscoveryOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.cache = new TtlCache<AlphaVantageSymbolMatch[]>(this.cacheTtlMs, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as AlphaVantageDiscoveryFetch);
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
  }

  isConfigured(): boolean {
    return loadAlphaVantageEnv() !== null;
  }

  async search(query: string): Promise<ProviderDiscoveryResult> {
    const q = query.trim();
    if (!q) return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: false };

    const env = loadAlphaVantageEnv();
    if (!env) {
      return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: "Alpha Vantage is not configured" };
    }

    const cacheKey = q.toLowerCase();
    // See binance-instrument-discovery.service.ts's identical comment -
    // TtlCache.get() would delete the expired entry before the
    // stale-fallback branch below could ever read it back.
    let matches = this.cache.getStale(cacheKey, this.cacheTtlMs)?.value;
    let stale = false;
    if (!matches) {
      try {
        matches = await this.fetchSymbolSearch(q, env.apiKey);
        this.cache.set(cacheKey, matches);
      } catch (error) {
        const staleRead = this.cache.getStale(cacheKey, this.staleMaxAgeMs);
        if (staleRead) {
          matches = staleRead.value;
          stale = true;
        } else {
          return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: error instanceof Error ? error.message : "Alpha Vantage discovery failed" };
        }
      }
    }

    const candidates: DiscoveredCandidate[] = matches
      .slice(0, MAX_RESULTS)
      .map((m) => ({
        provider: PROVIDER_NAME,
        providerSymbol: m["1. symbol"] ?? "",
        displayName: m["2. name"] ?? m["1. symbol"] ?? "Unknown instrument",
        country: m["4. region"],
        currency: m["8. currency"],
        assetClass: m["3. type"] === "Equity" ? ("equity" as const) : ("other" as const),
        marketCategory: m["3. type"] === "Equity" ? ("stocks" as const) : undefined,
        // Discovery-only - see file header.
        capabilities: [],
      }))
      .filter((c) => c.providerSymbol.length > 0);

    return { provider: PROVIDER_NAME, candidates, stale, failed: false };
  }

  private async fetchSymbolSearch(query: string, apiKey: string): Promise<AlphaVantageSymbolMatch[]> {
    const url = `${SYMBOL_SEARCH_URL}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${encodeURIComponent(apiKey)}`;
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url);
    } catch {
      throw new Error("Failed to reach Alpha Vantage SYMBOL_SEARCH");
    }
    if (!res.ok) throw new Error(`Alpha Vantage SYMBOL_SEARCH returned HTTP ${res.status}`);

    let body: AlphaVantageSymbolSearchResponse;
    try {
      body = (await res.json()) as AlphaVantageSymbolSearchResponse;
    } catch {
      throw new Error("Alpha Vantage SYMBOL_SEARCH response was not valid JSON");
    }
    // Same non-2xx-error contract as alpha-vantage.provider.ts's own
    // fetchQuote(): rate limiting/errors arrive as HTTP 200 with a
    // Note/Information/Error Message field, never a non-2xx status.
    if (typeof body.Note === "string" || typeof body.Information === "string") {
      throw new Error(`Alpha Vantage rate limit: ${body.Note ?? body.Information}`);
    }
    if (typeof body["Error Message"] === "string") {
      throw new Error(`Alpha Vantage error: ${body["Error Message"]}`);
    }
    return Array.isArray(body.bestMatches) ? body.bestMatches : [];
  }
}
