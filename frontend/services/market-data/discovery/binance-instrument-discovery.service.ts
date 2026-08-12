// services/market-data/discovery/binance-instrument-discovery.service.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Real, documented, public Binance endpoint - GET /api/v3/
// exchangeInfo returns every spot trading pair Binance lists (symbol,
// status, baseAsset, quoteAsset among many other fields), no API key or
// signature required (same "public market-data endpoints need no
// credentials" fact binance.provider.ts's own header already documents).
// This is genuinely Binance's own instrument catalog, not invented.
//
// Server-side only: this service is never imported by any client
// component. The full symbol universe (~2000+ pairs) is cached in one
// TtlCache entry (lib/market-data/cache.ts, the exact same primitive
// every existing provider already uses) rather than re-fetched per
// keystroke - a 6h TTL with a 24h stale-fallback grace window, matching
// the resilience idiom D2.3.S3 established for live quotes.
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import type { DiscoveredCandidate, ProviderDiscoveryResult } from "@/types/instrument-discovery";

const PROVIDER_NAME = "binance";
const EXCHANGE_INFO_URL = "https://api.binance.com/api/v3/exchangeInfo";
const CACHE_KEY = "exchangeInfo";
const DEFAULT_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_STALE_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_RESULTS = 25;
// Only quote assets a trader would recognize as a real, spendable
// settlement currency - Binance lists many low-liquidity quote assets
// this platform has no reason to surface. Real Binance field values,
// never invented.
const ALLOWED_QUOTE_ASSETS = new Set(["USDT", "USD", "USDC", "BUSD", "FDUSD"]);

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}
interface BinanceExchangeInfoResponse {
  symbols?: BinanceSymbolInfo[];
}
interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type BinanceDiscoveryFetch = (url: string) => Promise<FetchLikeResponse>;

export interface BinanceInstrumentDiscoveryOptions {
  cacheTtlMs?: number;
  staleMaxAgeMs?: number;
  clock?: Clock;
  fetchImpl?: BinanceDiscoveryFetch;
}

export class BinanceInstrumentDiscoveryService {
  readonly name = PROVIDER_NAME;
  private readonly cache: TtlCache<BinanceSymbolInfo[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: BinanceDiscoveryFetch;
  private readonly cacheTtlMs: number;
  private readonly staleMaxAgeMs: number;

  constructor(options: BinanceInstrumentDiscoveryOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.cache = new TtlCache<BinanceSymbolInfo[]>(this.cacheTtlMs, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as BinanceDiscoveryFetch);
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
  }

  async search(query: string): Promise<ProviderDiscoveryResult> {
    const q = query.trim().toUpperCase();
    if (!q) return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: false };

    // Sprint D2.6.12 fix: TtlCache.get() DELETES an expired entry as a
    // side effect (see lib/market-data/cache.ts), which would destroy the
    // exact fallback value the catch-branch below needs. Reads via
    // getStale(key, cacheTtlMs) instead - a non-destructive "is this
    // still fresh" check, the same idiom MarketDataService.getSnapshot()
    // already established (services/market-data/market-data.service.ts)
    // for its own live-then-stale-fallback resilience.
    let symbols = this.cache.getStale(CACHE_KEY, this.cacheTtlMs)?.value;
    let stale = false;
    if (!symbols) {
      try {
        symbols = await this.fetchExchangeInfo();
        this.cache.set(CACHE_KEY, symbols);
      } catch (error) {
        const staleRead = this.cache.getStale(CACHE_KEY, this.staleMaxAgeMs);
        if (staleRead) {
          symbols = staleRead.value;
          stale = true;
        } else {
          // A discovery failure never destroys anything - it simply
          // contributes zero candidates; the existing catalog search
          // (InstrumentSearchService) still runs independently.
          return { provider: PROVIDER_NAME, candidates: [], stale: false, failed: true, reason: error instanceof Error ? error.message : "Binance discovery failed" };
        }
      }
    }

    const candidates: DiscoveredCandidate[] = symbols
      .filter((s) => s.status === "TRADING" && ALLOWED_QUOTE_ASSETS.has(s.quoteAsset))
      .filter((s) => s.symbol.includes(q) || s.baseAsset.includes(q))
      .slice(0, MAX_RESULTS)
      .map((s) => ({
        provider: PROVIDER_NAME,
        providerSymbol: s.symbol,
        displayName: `${s.baseAsset} / ${s.quoteAsset}`,
        assetClass: "crypto",
        marketCategory: "crypto",
        currency: s.quoteAsset,
        // Binance's real, live adapter (binance.provider.ts) can genuinely
        // serve quote+candles for any TRADING spot symbol - this is a
        // real capability claim, not an aspiration.
        capabilities: ["quote", "candles"],
      }));

    return { provider: PROVIDER_NAME, candidates, stale, failed: false };
  }

  private async fetchExchangeInfo(): Promise<BinanceSymbolInfo[]> {
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(EXCHANGE_INFO_URL);
    } catch {
      throw new Error("Failed to reach Binance exchangeInfo");
    }
    if (!res.ok) throw new Error(`Binance exchangeInfo returned HTTP ${res.status}`);
    let body: BinanceExchangeInfoResponse;
    try {
      body = (await res.json()) as BinanceExchangeInfoResponse;
    } catch {
      throw new Error("Binance exchangeInfo response was not valid JSON");
    }
    if (!Array.isArray(body.symbols)) throw new Error("Binance exchangeInfo response did not contain a symbols array");
    return body.symbols;
  }
}
