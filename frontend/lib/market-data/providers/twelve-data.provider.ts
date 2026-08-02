// lib/market-data/providers/twelve-data.provider.ts
// Sprint D2.2 (Phase 2) - Twelve Data provider: the platform's new PRIMARY
// market-data source. Implements the existing, unmodified MarketDataProvider
// interface (types/market-data-provider.ts) so it is a drop-in for every
// consumer the AlphaVantageProvider already serves - the pipeline, the
// central MarketDataService, everything - without changing a line above the
// provider layer.
//
// Deliberately mirrors alpha-vantage.provider.ts's shape and testability:
// injectable fetchImpl/Clock, a provider-local TtlCache, typed
// MarketDataProviderError classification (consumers branch on `kind`, never
// on a message string), and the same honesty contract - it reports only what
// the vendor actually returned and NEVER fabricates trend/volatility/etc.
//
// Unlike Alpha Vantage's CURRENCY_EXCHANGE_RATE (spot only), Twelve Data's
// /quote endpoint returns real OHLC and market-open status, so this provider
// emits richer-but-still-honest evidence (spot, session OHLC, change,
// volume when present). The full structured quote is parsed once and kept in
// ParsedQuote; Sprint D2.2 Phase 6 will project that same internal object to
// the shared MarketSnapshot model. No provider-specific response object ever
// escapes this file.
//
// The API key lives in the query string, so this provider never logs the URL
// and never attaches a raw transport error (which could echo the key) as an
// error cause - only generic, key-free messages leave this layer.
import type {
  MarketDataProvider,
  SnapshotProvider,
  MarketContextRequest,
  MarketContextResult,
  MarketEvidenceItem,
} from "@/types/market-data-provider";
import type { MarketCategory } from "@/types/market";
import type { MarketSnapshot, MarketStatus } from "@/types/market-snapshot";
import { getMarket } from "../market-registry";
import { loadTwelveDataEnv, type TwelveDataEnv } from "../env";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "twelve-data";
const BASE_URL = "https://api.twelvedata.com/quote";
const DEFAULT_CACHE_TTL_MS = 60_000;

// Platform canonical symbol -> Twelve Data symbol + presentation metadata.
// assetClass/quoteCurrency are used for honest formatting and (from Phase 5/6)
// multi-market routing. Only symbols the configured plan can actually serve
// are worth listing; more are added as coverage is confirmed, exactly the
// same "list only what works" discipline the Alpha Vantage map follows.
interface SymbolSpec {
  td: string;
  quoteCurrency: string;
  assetClass: MarketCategory;
}
const SYMBOL_MAP: Record<string, SymbolSpec> = {
  EURUSD: { td: "EUR/USD", quoteCurrency: "USD", assetClass: "forex" },
  GBPUSD: { td: "GBP/USD", quoteCurrency: "USD", assetClass: "forex" },
  USDJPY: { td: "USD/JPY", quoteCurrency: "JPY", assetClass: "forex" },
  XAUUSD: { td: "XAU/USD", quoteCurrency: "USD", assetClass: "commodities" },
  XAGUSD: { td: "XAG/USD", quoteCurrency: "USD", assetClass: "commodities" },
  BTCUSD: { td: "BTC/USD", quoteCurrency: "USD", assetClass: "crypto" },
  ETHUSD: { td: "ETH/USD", quoteCurrency: "USD", assetClass: "crypto" },
};

/** Structured, provider-neutral quote parsed from Twelve Data. Never leaves this file in Phase 2. */
export interface ParsedQuote {
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  changePercent?: number;
  volume?: number;
  marketOpen?: boolean;
  exchange?: string;
  /** ISO timestamp, only ever set when reliably parsed from the vendor's unix `timestamp` - never guessed. */
  providerTimestamp?: string;
}

// Minimal shape of Twelve Data's documented /quote response - only the fields
// this adapter actually reads. Errors arrive as { status:"error", code, message }.
interface TwelveDataQuoteResponse {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  percent_change?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network. */
export type TwelveDataFetch = (url: string) => Promise<FetchLikeResponse>;

export interface TwelveDataProviderOptions {
  cacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: TwelveDataFetch;
}

function toFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

// Honest display: preserve the vendor's own precision by trimming trailing
// zeros from the parsed number rather than forcing a fixed decimal count that
// would be wrong across asset classes (5dp forex vs 2dp crypto vs whole-number
// volume). Never rounds a value into a different number.
function fmt(n: number): string {
  return Number.parseFloat(n.toPrecision(12)).toString();
}

export class TwelveDataProvider implements MarketDataProvider, SnapshotProvider {
  readonly name = PROVIDER_NAME;
  private readonly env: TwelveDataEnv | null;
  private readonly cache: TtlCache<ParsedQuote>;
  private readonly clock: Clock;
  private readonly fetchImpl: TwelveDataFetch;

  constructor(options: TwelveDataProviderOptions = {}) {
    this.env = loadTwelveDataEnv();
    this.clock = options.clock ?? systemClock;
    this.cache = new TtlCache<ParsedQuote>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as TwelveDataFetch);
  }

  isConfigured(): boolean {
    return this.env !== null;
  }

  /** Canonical symbols this provider maps today. Exposed so callers/registries can advertise coverage without reaching into SYMBOL_MAP. */
  supportedSymbols(): string[] {
    return Object.keys(SYMBOL_MAP);
  }

  private resolveSymbol(symbol: string): SymbolSpec {
    const spec = SYMBOL_MAP[symbol];
    if (!spec) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is not mapped for ${PROVIDER_NAME} (supported: ${Object.keys(SYMBOL_MAP).join(", ")})`,
        PROVIDER_NAME,
      );
    }
    return spec;
  }

  // Shared cache+fetch used by both getMarketContext (evidence view) and
  // getSnapshot (structured view) so a single vendor call serves both and the
  // 60s TTL cache is honoured across them.
  private async getParsedQuote(spec: SymbolSpec): Promise<ParsedQuote> {
    if (!this.env) {
      throw new MarketDataProviderError(
        "unconfigured",
        `${PROVIDER_NAME} is not configured (missing TWELVEDATA_API_KEY)`,
        PROVIDER_NAME,
      );
    }
    let quote = this.cache.get(spec.td);
    if (!quote) {
      quote = await this.fetchQuote(spec.td, this.env.apiKey);
      this.cache.set(spec.td, quote);
    }
    return quote;
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    const spec = this.resolveSymbol(request.symbol);
    const quote = await this.getParsedQuote(spec);

    const retrievedAt = new Date(this.clock.now()).toISOString();
    // The provider's own reading time when known (may be older than
    // retrievedAt on a cache hit - that staleness is real and reported
    // honestly, not hidden behind "now"), exactly as Alpha Vantage does.
    const asOf = quote.providerTimestamp ?? retrievedAt;
    const cur = spec.quoteCurrency;

    const evidence: MarketEvidenceItem[] = [
      { claim: `Spot price: ${fmt(quote.close)} ${cur}`, source: PROVIDER_NAME, asOf },
    ];
    if (quote.open !== undefined && quote.high !== undefined && quote.low !== undefined) {
      evidence.push({
        claim: `Session OHLC: open ${fmt(quote.open)}, high ${fmt(quote.high)}, low ${fmt(quote.low)}, close ${fmt(quote.close)} ${cur}`,
        source: PROVIDER_NAME,
        asOf,
      });
    }
    if (quote.changePercent !== undefined) {
      evidence.push({ claim: `Session change: ${fmt(quote.changePercent)}%`, source: PROVIDER_NAME, asOf });
    }
    if (quote.volume !== undefined) {
      evidence.push({ claim: `Session volume: ${fmt(quote.volume)}`, source: PROVIDER_NAME, asOf });
    }

    return {
      symbol: request.symbol,
      provider: PROVIDER_NAME,
      retrievedAt,
      evidence,
      // trend/volatility/liquidity/riskLevel/sentiment/technicalSummary/
      // headlines: intentionally omitted - a raw quote has no opinion on any
      // of them, and inventing one would fabricate market data.
    };
  }

  // Sprint D2.2 Phase 6 - the structured, canonical view. Maps the SAME parsed
  // quote used for evidence into the shared MarketSnapshot model. assetClass
  // and human name come from the provider-independent market registry; every
  // other field is copied straight from the vendor value or left undefined -
  // never a guessed default.
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const spec = this.resolveSymbol(request.symbol);
    const quote = await this.getParsedQuote(spec);
    const retrievedAt = new Date(this.clock.now()).toISOString();
    const marketStatus: MarketStatus =
      quote.marketOpen === true ? "open" : quote.marketOpen === false ? "closed" : "unknown";

    return {
      symbol: request.symbol,
      name: getMarket(request.symbol)?.name,
      assetClass: spec.assetClass,
      price: quote.close,
      ohlc:
        quote.open !== undefined && quote.high !== undefined && quote.low !== undefined
          ? { open: quote.open, high: quote.high, low: quote.low, close: quote.close }
          : undefined,
      changePercent: quote.changePercent,
      volume: quote.volume,
      quoteCurrency: spec.quoteCurrency,
      timestamp: quote.providerTimestamp ?? retrievedAt,
      timezone: "UTC",
      marketStatus,
      provider: PROVIDER_NAME,
      retrievedAt,
    };
  }

  private async fetchQuote(tdSymbol: string, apiKey: string): Promise<ParsedQuote> {
    const url = `${BASE_URL}?symbol=${encodeURIComponent(tdSymbol)}&apikey=${encodeURIComponent(apiKey)}`;

    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url);
    } catch {
      // The URL carries the key - never attach the raw transport error as a
      // cause, and never echo the URL, so the key cannot leak into a log.
      throw new MarketDataProviderError("http_error", "Failed to reach Twelve Data", PROVIDER_NAME);
    }

    if (!res.ok && res.status !== 200) {
      const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "http_error";
      throw new MarketDataProviderError(kind, `Twelve Data returned HTTP ${res.status}`, PROVIDER_NAME);
    }

    let body: TwelveDataQuoteResponse;
    try {
      body = (await res.json()) as TwelveDataQuoteResponse;
    } catch {
      throw new MarketDataProviderError("invalid_response", "Twelve Data response was not valid JSON", PROVIDER_NAME);
    }

    // Twelve Data reports errors (invalid symbol, exhausted credits, bad key)
    // as a JSON body with status:"error" and a numeric code - classify by
    // code, never by string-matching the human message.
    if (body.status === "error" || typeof body.code === "number") {
      const code = body.code ?? 0;
      const kind =
        code === 401 || code === 403 ? "auth" : code === 429 ? "rate_limit" : code === 404 || code === 400 ? "invalid_response" : "unknown";
      throw new MarketDataProviderError(kind, `Twelve Data error (${code}): ${body.message ?? "unknown error"}`, PROVIDER_NAME);
    }

    const close = toFiniteNumber(body.close);
    if (close === undefined) {
      throw new MarketDataProviderError("invalid_response", "Twelve Data response did not contain a parseable close price", PROVIDER_NAME);
    }

    return {
      price: close,
      close,
      open: toFiniteNumber(body.open),
      high: toFiniteNumber(body.high),
      low: toFiniteNumber(body.low),
      changePercent: toFiniteNumber(body.percent_change),
      volume: toFiniteNumber(body.volume),
      marketOpen: typeof body.is_market_open === "boolean" ? body.is_market_open : undefined,
      exchange: typeof body.exchange === "string" ? body.exchange : undefined,
      providerTimestamp: this.parseProviderTimestamp(body.timestamp),
    };
  }

  // Twelve Data's `timestamp` is unix seconds (unambiguous, UTC). Only ever
  // returns an ISO string when it is a finite positive number - the
  // timezone-local `datetime` string is deliberately NOT parsed as UTC (that
  // would misstate the time), matching Alpha Vantage's "only when confident"
  // policy.
  private parseProviderTimestamp(timestamp?: number): string | undefined {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
    const parsed = new Date(timestamp * 1000);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
}
