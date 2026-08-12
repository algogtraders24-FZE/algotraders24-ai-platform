// services/market-data/discovery/twelve-data-instrument-discovery.service.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Twelve Data's real, documented public endpoint GET
// https://api.twelvedata.com/symbol_search?symbol=<query>&apikey=<key> -
// returns real matches across stocks/forex/crypto/ETFs/indices with
// their own exchange field (e.g. "NASDAQ", "NYSE"). Reuses the exact
// same configured TWELVEDATA_API_KEY twelve-data.provider.ts already
// loads server-side via lib/market-data/env.ts's loadTwelveDataEnv() -
// never a second key, never exposed to the browser.
//
// Discovery-only, by design: twelve-data.provider.ts's own header
// documents its SYMBOL_MAP as EXISTING, FROZEN, already-tested code -
// this sprint's own instruction is to "preserve the existing frozen
// provider symbol mappings," never rewrite that adapter to accept an
// arbitrary discovered symbol. A Twelve-Data-discovered instrument
// therefore always reports zero market-data capabilities (search/chart-
// metadata value only, matching the AAPL precedent already established
// in instrument-catalog.ts - findable, honestly not fetchable) UNLESS a
// future sprint deliberately extends that frozen adapter.
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import { loadTwelveDataEnv } from "@/lib/market-data/env";
import type { DiscoveredCandidate, ProviderDiscoveryResult } from "@/types/instrument-discovery";
import type { InstrumentAssetClass } from "@/types/canonical-instrument";
import type { MarketCategory } from "@/types/market";

const PROVIDER_NAME = "twelve-data";
const SYMBOL_SEARCH_URL = "https://api.twelvedata.com/symbol_search";
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_STALE_MAX_AGE_MS = 60 * 60_000;
const MAX_RESULTS = 20;

// Twelve Data's own documented `instrument_type` values, mapped to this
// platform's existing MarketCategory union - undefined (never guessed)
// for any type this platform has no real category for.
const INSTRUMENT_TYPE_TO_CATEGORY: Record<string, { assetClass: InstrumentAssetClass; marketCategory?: MarketCategory }> = {
  "Common Stock": { assetClass: "equity", marketCategory: "stocks" },
  "Digital Currency": { assetClass: "crypto", marketCategory: "crypto" },
  "Physical Currency": { assetClass: "forex", marketCategory: "forex" },
  ETF: { assetClass: "etf" },
  Index: { assetClass: "index", marketCategory: "indices" },
};

interface TwelveDataSymbolSearchMatch {
  symbol?: string;
  instrument_name?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  instrument_type?: string;
}
interface TwelveDataSymbolSearchResponse {
  data?: TwelveDataSymbolSearchMatch[];
  status?: string;
  code?: number;
  message?: string;
}
interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type TwelveDataDiscoveryFetch = (url: string) => Promise<FetchLikeResponse>;

export interface TwelveDataInstrumentDiscoveryOptions {
  cacheTtlMs?: number;
  staleMaxAgeMs?: number;
  clock?: Clock;
  fetchImpl?: TwelveDataDiscoveryFetch;
}

export class TwelveDataInstrumentDiscoveryService {
  readonly name = PROVIDER_NAME;
  private readonly cache: TtlCache<TwelveDataSymbolSearchMatch[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: TwelveDataDiscoveryFetch;
  private readonly cacheTtlMs: number;
  private readonly staleMaxAgeMs: number;

  constructor(options: TwelveDataInstrumentDiscoveryOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.cache = new TtlCache<TwelveDataSymbolSearchMatch[]>(this.cacheTtlMs, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as TwelveDataDiscoveryFetch);
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
  }

  isConfigured(): boolean {
    return loadTwelveDataEnv() !== null;
  }

  async search(query: string): Promise<ProviderDiscoveryResult> {
    const q = query.trim();
    if (!q) return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: false };

    const env = loadTwelveDataEnv();
    if (!env) {
      return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: "Twelve Data is not configured" };
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
          return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: error instanceof Error ? error.message : "Twelve Data discovery failed" };
        }
      }
    }

    const candidates: DiscoveredCandidate[] = matches.slice(0, MAX_RESULTS).map((m) => {
      const category = m.instrument_type ? INSTRUMENT_TYPE_TO_CATEGORY[m.instrument_type] : undefined;
      return {
        provider: PROVIDER_NAME,
        providerSymbol: m.symbol ?? "",
        displayName: m.instrument_name ?? m.symbol ?? "Unknown instrument",
        exchange: m.exchange,
        country: m.country,
        currency: m.currency,
        assetClass: category?.assetClass ?? "other",
        marketCategory: category?.marketCategory,
        // Discovery-only - see file header. This provider's own real
        // adapter cannot fetch a live quote/candles for an arbitrary
        // discovered symbol without rewriting its frozen SYMBOL_MAP,
        // which this sprint deliberately does not do.
        capabilities: [],
      };
    }).filter((c) => c.providerSymbol.length > 0);

    return { provider: PROVIDER_NAME, candidates, stale, failed: false };
  }

  private async fetchSymbolSearch(query: string, apiKey: string): Promise<TwelveDataSymbolSearchMatch[]> {
    const url = `${SYMBOL_SEARCH_URL}?symbol=${encodeURIComponent(query)}&apikey=${encodeURIComponent(apiKey)}`;
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url);
    } catch {
      // The URL carries the key - never attach the raw transport error, which could echo it.
      throw new Error("Failed to reach Twelve Data symbol_search");
    }
    if (!res.ok) throw new Error(`Twelve Data symbol_search returned HTTP ${res.status}`);

    let body: TwelveDataSymbolSearchResponse;
    try {
      body = (await res.json()) as TwelveDataSymbolSearchResponse;
    } catch {
      throw new Error("Twelve Data symbol_search response was not valid JSON");
    }
    if (body.status === "error" || typeof body.code === "number") {
      throw new Error(`Twelve Data symbol_search error (${body.code ?? "unknown"}): ${body.message ?? "unknown error"}`);
    }
    return Array.isArray(body.data) ? body.data : [];
  }
}
