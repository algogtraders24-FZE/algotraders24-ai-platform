// lib/market-data/providers/alpha-vantage.provider.ts
// Sprint 15D.3A - First real MarketDataProvider implementation.
//
// Alpha Vantage has no separate "commodities spot" endpoint for metals;
// XAU/XAG are ISO-4217 currency codes and gold/silver spot price is
// retrieved through their documented CURRENCY_EXCHANGE_RATE function
// (from_currency=XAU|XAG, to_currency=USD). This is the official,
// documented mechanism, not a workaround. Historical/OHLC data is
// explicitly out of scope for this slice (locked decision #9).
//
// Sprint L2.1 - During the first live wiring of this provider into a real
// page, direct testing against the currently configured
// ALPHA_VANTAGE_API_KEY found that CURRENCY_EXCHANGE_RATE genuinely rejects
// XAU/XAG for this key/tier ("Invalid API call...") while the exact same
// endpoint and key succeed for a real currency pair (EUR/USD returned a
// live rate). This isn't a rate limit - that failure mode returns a
// distinctly different "Information" message, also confirmed separately.
// EURUSD is added below as the first symbol this provider can actually
// serve end to end today. XAU/XAG stay mapped (the code path is correct
// and will work the moment a metals-capable key/plan is in place) but are
// surfaced to users as pending, not available - see
// app/dashboard/market-intelligence/page.tsx.
//
// Never fabricates: trend, volatility, liquidity, riskLevel, sentiment,
// technicalSummary, and headlines are never set by this provider - the
// realtime exchange-rate endpoint has no opinion on any of them, and
// MarketContextResult already leaves them optional for exactly this
// reason (see types/market-data-provider.ts). Only the spot price (as
// evidence) and, when reliably parseable, the provider's own "Last
// Refreshed" timestamp are ever reported.
import type {
  MarketDataProvider,
  SnapshotProvider,
  MarketContextRequest,
  MarketContextResult,
} from "@/types/market-data-provider";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { MarketCategory } from "@/types/market";
import { getMarket } from "../market-registry";
import { loadAlphaVantageEnv, type AlphaVantageEnv } from "../env";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "alpha-vantage";
const BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_CACHE_TTL_MS = 60_000;

// Platform canonical symbol -> Alpha Vantage currency code. Originally
// locked to XAU/XAG only (decision #2); EURUSD added in Sprint L2.1 as the
// first symbol confirmed to actually work against the configured key (see
// file header). XAU/XAG remain mapped for when a metals-capable key/plan
// is available.
const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EUR",
  XAUUSD: "XAU",
  XAGUSD: "XAG",
};

// Sprint D2.8.1 - asset class for the same canonical symbols above, needed
// only by getSnapshot()'s MarketSnapshot.assetClass field. Kept as its own
// map (rather than folding into SYMBOL_MAP) so normalizeSymbol()'s existing
// string-only contract is untouched.
const ASSET_CLASS_MAP: Record<string, MarketCategory> = {
  EURUSD: "forex",
  XAUUSD: "commodities",
  XAGUSD: "commodities",
};

interface CachedQuote {
  price: number;
  bid?: number;
  ask?: number;
  /** ISO timestamp, only ever set when reliably parsed - never guessed. */
  providerTimestamp?: string;
}

// Minimal shape of Alpha Vantage's documented CURRENCY_EXCHANGE_RATE
// response - only the fields this adapter actually reads.
interface AlphaVantageExchangeRateResponse {
  "Realtime Currency Exchange Rate"?: {
    "5. Exchange Rate"?: string;
    "6. Last Refreshed"?: string;
    "7. Time Zone"?: string;
    "8. Bid Price"?: string;
    "9. Ask Price"?: string;
  };
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network. */
export type AlphaVantageFetch = (url: string) => Promise<FetchLikeResponse>;

export interface AlphaVantageProviderOptions {
  cacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: AlphaVantageFetch;
}

export class AlphaVantageProvider implements MarketDataProvider, SnapshotProvider {
  readonly name = PROVIDER_NAME;
  private readonly env: AlphaVantageEnv | null;
  private readonly cache: TtlCache<CachedQuote>;
  private readonly clock: Clock;
  private readonly fetchImpl: AlphaVantageFetch;

  constructor(options: AlphaVantageProviderOptions = {}) {
    this.env = loadAlphaVantageEnv();
    this.clock = options.clock ?? systemClock;
    this.cache = new TtlCache<CachedQuote>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as AlphaVantageFetch);
  }

  isConfigured(): boolean {
    return this.env !== null;
  }

  private normalizeSymbol(symbol: string): string {
    const providerSymbol = SYMBOL_MAP[symbol];
    if (!providerSymbol) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is not supported by ${PROVIDER_NAME} in this slice (supported: ${Object.keys(SYMBOL_MAP).join(", ")})`,
        PROVIDER_NAME,
      );
    }
    return providerSymbol;
  }

  // Sprint D2.8.1 - the structured, canonical view, mirroring Twelve Data's
  // getSnapshot() shape/conventions. Alpha Vantage is spot-only (no OHLC/
  // volume/market-open status), so those fields are correctly left
  // undefined here - never fabricated. The one thing this provider offers
  // that Twelve Data doesn't is a real bid/ask, which is why this method
  // exists at all: to let that already-real data reach MarketSnapshot
  // through the existing SnapshotProvider capability, instead of being
  // stranded in getMarketContext()'s evidence array. bid/ask are only ever
  // set when BOTH are finite, positive, and ask >= bid - an invalid or
  // partial pair is rejected (left undefined), never normalized into a
  // fake value.
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    if (!this.env) {
      throw new MarketDataProviderError(
        "unconfigured",
        `${PROVIDER_NAME} is not configured (missing ALPHA_VANTAGE_API_KEY)`,
        PROVIDER_NAME,
      );
    }
    const providerSymbol = this.normalizeSymbol(request.symbol);
    const assetClass = ASSET_CLASS_MAP[request.symbol];
    if (!assetClass) {
      // Cannot happen today (SYMBOL_MAP and ASSET_CLASS_MAP are kept in
      // sync above), but this is the honest failure mode if they ever
      // drift rather than silently guessing an asset class.
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${request.symbol}" has no asset-class mapping for ${PROVIDER_NAME}`,
        PROVIDER_NAME,
      );
    }

    let quote = this.cache.get(providerSymbol);
    if (!quote) {
      quote = await this.fetchQuote(providerSymbol, this.env.apiKey);
      this.cache.set(providerSymbol, quote);
    }

    const retrievedAt = new Date(this.clock.now()).toISOString();
    const validBidAsk =
      quote.bid !== undefined &&
      quote.ask !== undefined &&
      Number.isFinite(quote.bid) &&
      Number.isFinite(quote.ask) &&
      quote.bid > 0 &&
      quote.ask > 0 &&
      quote.ask >= quote.bid;

    return {
      symbol: request.symbol,
      name: getMarket(request.symbol)?.name,
      assetClass,
      price: quote.price,
      bid: validBidAsk ? quote.bid : undefined,
      ask: validBidAsk ? quote.ask : undefined,
      // ohlc/volume/changePercent: never reported - the exchange-rate
      // endpoint this provider calls has no session OHLC or volume, and
      // fabricating them would violate the "no guessed values" contract.
      quoteCurrency: "USD",
      timestamp: quote.providerTimestamp ?? retrievedAt,
      timezone: "UTC",
      // Alpha Vantage's realtime-exchange-rate endpoint reports no
      // open/closed signal - "unknown" is the honest value, not a guess.
      marketStatus: "unknown",
      provider: PROVIDER_NAME,
      retrievedAt,
      providerSymbol,
    };
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    if (!this.env) {
      throw new MarketDataProviderError(
        "unconfigured",
        `${PROVIDER_NAME} is not configured (missing ALPHA_VANTAGE_API_KEY)`,
        PROVIDER_NAME,
      );
    }
    const providerSymbol = this.normalizeSymbol(request.symbol);

    let quote = this.cache.get(providerSymbol);
    if (!quote) {
      quote = await this.fetchQuote(providerSymbol, this.env.apiKey);
      this.cache.set(providerSymbol, quote);
    }

    const retrievedAt = new Date(this.clock.now()).toISOString();
    // The evidence timestamp is the provider's own reading time when known
    // (may be older than retrievedAt on a cache hit - that staleness is
    // real and must be reported honestly, not hidden behind "now").
    const asOf = quote.providerTimestamp ?? retrievedAt;

    const evidence = [
      { claim: `Spot price: ${quote.price.toFixed(4)} USD`, source: PROVIDER_NAME, asOf },
    ];
    if (quote.bid !== undefined && quote.ask !== undefined) {
      evidence.push({
        claim: `Bid/Ask: ${quote.bid.toFixed(4)} / ${quote.ask.toFixed(4)} USD`,
        source: PROVIDER_NAME,
        asOf,
      });
    }

    return {
      symbol: request.symbol,
      provider: PROVIDER_NAME,
      retrievedAt,
      evidence,
      // trend, volatility, liquidity, riskLevel, sentiment, technicalSummary,
      // headlines: intentionally omitted - see file header.
    };
  }

  private async fetchQuote(providerSymbol: string, apiKey: string): Promise<CachedQuote> {
    const url = `${BASE_URL}?function=CURRENCY_EXCHANGE_RATE&from_currency=${providerSymbol}&to_currency=USD&apikey=${apiKey}`;

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

    let body: AlphaVantageExchangeRateResponse;
    try {
      body = (await res.json()) as AlphaVantageExchangeRateResponse;
    } catch (error) {
      throw new MarketDataProviderError("invalid_response", "Alpha Vantage response was not valid JSON", PROVIDER_NAME, error);
    }

    // Alpha Vantage reports rate limiting and errors with HTTP 200 and a
    // "Note"/"Information"/"Error Message" field instead of a non-2xx
    // status - these must be detected explicitly, never treated as a
    // successful (if empty) quote.
    if (typeof body.Note === "string" || typeof body.Information === "string") {
      const text = body.Note ?? body.Information ?? "";
      throw new MarketDataProviderError("rate_limit", `Alpha Vantage rate limit: ${text}`, PROVIDER_NAME);
    }

    if (typeof body["Error Message"] === "string") {
      const message = body["Error Message"];
      const isAuth = /api ?key/i.test(message);
      throw new MarketDataProviderError(isAuth ? "auth" : "invalid_response", `Alpha Vantage error: ${message}`, PROVIDER_NAME);
    }

    const payload = body["Realtime Currency Exchange Rate"];
    const rawPrice = payload?.["5. Exchange Rate"];
    const price = rawPrice !== undefined ? Number.parseFloat(rawPrice) : NaN;
    if (!payload || Number.isNaN(price)) {
      throw new MarketDataProviderError(
        "invalid_response",
        "Alpha Vantage response did not contain a parseable exchange rate",
        PROVIDER_NAME,
      );
    }

    const bid = payload["8. Bid Price"] !== undefined ? Number.parseFloat(payload["8. Bid Price"]) : undefined;
    const ask = payload["9. Ask Price"] !== undefined ? Number.parseFloat(payload["9. Ask Price"]) : undefined;

    return {
      price,
      bid: bid !== undefined && !Number.isNaN(bid) ? bid : undefined,
      ask: ask !== undefined && !Number.isNaN(ask) ? ask : undefined,
      providerTimestamp: this.parseProviderTimestamp(payload["6. Last Refreshed"], payload["7. Time Zone"]),
    };
  }

  // Only ever returns a timestamp when it can be parsed with confidence
  // (Alpha Vantage's documented UTC case). A non-UTC zone or an
  // unparseable string is treated as "not available", never guessed.
  private parseProviderTimestamp(lastRefreshed?: string, timeZone?: string): string | undefined {
    if (!lastRefreshed || !timeZone || timeZone.toUpperCase() !== "UTC") return undefined;
    const parsed = new Date(`${lastRefreshed.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
}
