// lib/market-data/providers/binance.provider.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. Implements the existing, UNMODIFIED MarketDataProvider/
// SnapshotProvider/TimeSeriesProvider interfaces (types/market-data-
// provider.ts) exactly like TwelveDataProvider/AlphaVantageProvider - a
// drop-in for MarketDataService's provider array, no changes above the
// provider layer.
//
// Binance's public market-data REST endpoints (/ticker/24hr, /klines,
// /ticker/price) require NO API key or signature - only Binance's
// private/trading endpoints (order placement, account info) do. This
// adapter therefore never reads BINANCE_API_KEY - it is genuinely
// unnecessary for the capability this adapter provides, not an oversight.
// (The project's .env.local BINANCE_API_KEY line is additionally
// malformed - a second value is concatenated into the same line rather
// than being its own SEC_KEY variable - but that's moot here since no
// key is used at all.)
//
// Response shapes verified live before this file was written (2026-08-10,
// against https://api.binance.com): GET /api/v3/ticker/24hr?symbol=
// BTCUSDT returned real lastPrice/openPrice/highPrice/lowPrice/volume/
// priceChangePercent/closeTime fields; GET /api/v3/klines?symbol=
// BTCUSDT&interval=1h&limit=3 returned the documented
// [openTime,open,high,low,close,volume,closeTime,...] array-of-arrays
// shape; an unsupported symbol returned real HTTP 400 with
// {code:-1121,msg:"Invalid symbol."}. Never added on assumption alone -
// same discipline as every other provider adapter in this codebase.
//
// Symbol mapping note: this platform's canonical BTCUSD/ETHUSD/SOLUSD/
// XRPUSD instruments map to Binance's real, live, actively-traded
// BTCUSDT/ETHUSDT/SOLUSDT/XRPUSDT pairs (USDT is a USD-pegged
// stablecoin) - a disclosed, documented approximation of a REAL market
// price, never a synthesized one.
//
// Symbol source of truth: this adapter has no prior frozen symbol table
// (unlike Twelve Data/Alpha Vantage), so it reads its mapping directly
// from lib/market-data/instrument-catalog.ts - a single source of truth,
// not a second copy to keep in sync. Adding a new Binance-covered
// instrument means adding one providerMapping to the catalog, never
// editing this file.
import type {
  MarketDataProvider,
  SnapshotProvider,
  TimeSeriesProvider,
  MarketContextRequest,
  MarketContextResult,
  MarketEvidenceItem,
} from "@/types/market-data-provider";
import type { MarketCategory } from "@/types/market";
import type { MarketSnapshot, MarketStatus } from "@/types/market-snapshot";
import type { Candle, TimeSeriesRequest } from "@/types/market-candle";
import type { MarketDataCapability } from "@/types/canonical-instrument";
import { getMarket } from "../market-registry";
import { mappingsForProvider } from "../instrument-catalog";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "binance";
const BASE_URL = "https://api.binance.com/api/v3";
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CANDLE_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_INTERVAL = "1d";
const DEFAULT_LIMIT = 100;

interface SymbolSpec {
  binance: string;
  quoteCurrency: string;
  assetClass: MarketCategory;
  capabilities: MarketDataCapability[];
}

// Sprint D2.6.12 - computed fresh on every call (not a load-time
// constant) so an instrument registered at runtime by
// UniversalInstrumentDiscoveryService (lib/market-data/instrument-
// catalog.ts's additive DISCOVERED registry) becomes resolvable
// immediately, with no server restart - still a single source of truth
// (the catalog), never a second, independently-maintained symbol table.
// Functionally identical output to the old load-time constant for every
// pre-existing symbol (same mappingsForProvider() call, same shape) -
// only the WHEN changed, confirmed by the unmodified pre-existing
// provider test suite still passing byte-for-byte.
function getSymbolMap(): Record<string, SymbolSpec> {
  return Object.fromEntries(
    mappingsForProvider(PROVIDER_NAME).map(({ instrument, mapping }) => [
      instrument.id,
      {
        binance: mapping.providerSymbol,
        quoteCurrency: instrument.currency ?? "USD",
        assetClass: instrument.marketCategory ?? "crypto",
        capabilities: mapping.supportedCapabilities,
      },
    ]),
  );
}

/** Structured, provider-neutral quote parsed from Binance's /ticker/24hr. Never leaves this file. */
export interface ParsedQuote {
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  changePercent?: number;
  volume?: number;
  /** ISO timestamp, only ever set when reliably parsed from Binance's unix-ms `closeTime` - never guessed. */
  providerTimestamp?: string;
}

// Minimal shape of Binance's documented GET /ticker/24hr response - only
// the fields this adapter actually reads.
interface Binance24hrResponse {
  symbol?: string;
  lastPrice?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  priceChangePercent?: string;
  volume?: string;
  closeTime?: number;
  code?: number;
  msg?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network. */
export type BinanceFetch = (url: string) => Promise<FetchLikeResponse>;

export interface BinanceProviderOptions {
  cacheTtlMs?: number;
  candleCacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: BinanceFetch;
}

// Binance's kline row is a fixed-position array, not an object - the
// documented shape is [openTime, open, high, low, close, volume,
// closeTime, quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume,
// takerBuyQuoteAssetVolume, ignore].
type BinanceKlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

function toFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

// Honest display: preserve the vendor's own precision by trimming
// trailing zeros rather than forcing a fixed decimal count - same
// convention as twelve-data.provider.ts's fmt().
function fmt(n: number): string {
  return Number.parseFloat(n.toPrecision(12)).toString();
}

export class BinanceProvider implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = PROVIDER_NAME;
  private readonly cache: TtlCache<ParsedQuote>;
  private readonly candleCache: TtlCache<Candle[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: BinanceFetch;

  constructor(options: BinanceProviderOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.cache = new TtlCache<ParsedQuote>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, this.clock);
    this.candleCache = new TtlCache<Candle[]>(options.candleCacheTtlMs ?? DEFAULT_CANDLE_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as BinanceFetch);
  }

  /** Always true - Binance's public market-data endpoints need no credentials, so this adapter is never "unconfigured". */
  isConfigured(): boolean {
    return true;
  }

  /** Canonical symbols this provider maps today (static + runtime-discovered) - exposed so callers/registries can advertise coverage without reaching into the symbol map directly. */
  supportedSymbols(): string[] {
    return Object.keys(getSymbolMap());
  }

  // Capability-checked before every request (sprint §7): a symbol mapped
  // for this provider but not declared to support the requested
  // capability (e.g. a quote-only mapping asked for candles) is rejected
  // the same honest way as a symbol not mapped at all - never silently
  // attempted anyway.
  private resolveSymbol(symbol: string, requiredCapability: MarketDataCapability): SymbolSpec {
    const symbolMap = getSymbolMap();
    const spec = symbolMap[symbol];
    if (!spec) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is not mapped for ${PROVIDER_NAME} (supported: ${Object.keys(symbolMap).join(", ")})`,
        PROVIDER_NAME,
      );
    }
    if (!spec.capabilities.includes(requiredCapability)) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is mapped for ${PROVIDER_NAME} but does not declare "${requiredCapability}" capability`,
        PROVIDER_NAME,
      );
    }
    return spec;
  }

  private async getParsedQuote(spec: SymbolSpec): Promise<ParsedQuote> {
    let quote = this.cache.get(spec.binance);
    if (!quote) {
      quote = await this.fetch24hr(spec.binance);
      this.cache.set(spec.binance, quote);
    }
    return quote;
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    const spec = this.resolveSymbol(request.symbol, "quote");
    const quote = await this.getParsedQuote(spec);

    const retrievedAt = new Date(this.clock.now()).toISOString();
    const asOf = quote.providerTimestamp ?? retrievedAt;
    const cur = spec.quoteCurrency;

    const evidence: MarketEvidenceItem[] = [{ claim: `Spot price: ${fmt(quote.close)} ${cur}`, source: PROVIDER_NAME, asOf }];
    if (quote.open !== undefined && quote.high !== undefined && quote.low !== undefined) {
      evidence.push({
        claim: `24h OHLC: open ${fmt(quote.open)}, high ${fmt(quote.high)}, low ${fmt(quote.low)}, close ${fmt(quote.close)} ${cur}`,
        source: PROVIDER_NAME,
        asOf,
      });
    }
    if (quote.changePercent !== undefined) {
      evidence.push({ claim: `24h change: ${fmt(quote.changePercent)}%`, source: PROVIDER_NAME, asOf });
    }
    if (quote.volume !== undefined) {
      evidence.push({ claim: `24h volume: ${fmt(quote.volume)}`, source: PROVIDER_NAME, asOf });
    }

    return {
      symbol: request.symbol,
      provider: PROVIDER_NAME,
      retrievedAt,
      evidence,
      // trend/volatility/liquidity/riskLevel/sentiment/technicalSummary/
      // headlines: intentionally omitted - a raw 24h ticker has no
      // opinion on any of them, and inventing one would fabricate data.
    };
  }

  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const spec = this.resolveSymbol(request.symbol, "quote");
    const quote = await this.getParsedQuote(spec);
    const retrievedAt = new Date(this.clock.now()).toISOString();
    // Binance's spot market trades 24/7 - "open" is always honest here,
    // never a guess (crypto has no exchange-hours concept to approximate).
    const marketStatus: MarketStatus = "open";

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
      providerSymbol: spec.binance,
    };
  }

  /** Historical candles for the real indicator engine, oldest-first, cached per symbol+interval+limit on a longer TTL than the live quote. */
  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
    const spec = this.resolveSymbol(request.symbol, "candles");
    const interval = request.interval ?? DEFAULT_INTERVAL;
    const limit = request.outputSize ?? DEFAULT_LIMIT;
    const cacheKey = `${spec.binance}|${interval}|${limit}`;

    let candles = this.candleCache.get(cacheKey);
    if (!candles) {
      candles = await this.fetchKlines(spec.binance, interval, limit);
      this.candleCache.set(cacheKey, candles);
    }
    return candles;
  }

  private async request<T>(url: string): Promise<T> {
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url);
    } catch {
      throw new MarketDataProviderError("http_error", "Failed to reach Binance", PROVIDER_NAME);
    }

    let body: T & { code?: number; msg?: string };
    try {
      body = (await res.json()) as T & { code?: number; msg?: string };
    } catch {
      throw new MarketDataProviderError("invalid_response", "Binance response was not valid JSON", PROVIDER_NAME);
    }

    if (!res.ok) {
      // Binance reports errors as HTTP 4xx/5xx with a JSON {code, msg} body
      // (e.g. -1121 "Invalid symbol.") - classify by HTTP status first
      // (matches the documented contract), never by string-matching msg.
      const kind =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 429 || res.status === 418
            ? "rate_limit"
            : res.status === 400 && body.code === -1121
              ? "unsupported_symbol"
              : "http_error";
      throw new MarketDataProviderError(kind, `Binance returned HTTP ${res.status}${body.msg ? `: ${body.msg}` : ""}`, PROVIDER_NAME);
    }
    return body;
  }

  private async fetch24hr(binanceSymbol: string): Promise<ParsedQuote> {
    const url = `${BASE_URL}/ticker/24hr?symbol=${encodeURIComponent(binanceSymbol)}`;
    const body = await this.request<Binance24hrResponse>(url);

    const close = toFiniteNumber(body.lastPrice);
    if (close === undefined) {
      throw new MarketDataProviderError("invalid_response", "Binance response did not contain a parseable lastPrice", PROVIDER_NAME);
    }

    return {
      price: close,
      close,
      open: toFiniteNumber(body.openPrice),
      high: toFiniteNumber(body.highPrice),
      low: toFiniteNumber(body.lowPrice),
      changePercent: toFiniteNumber(body.priceChangePercent),
      volume: toFiniteNumber(body.volume),
      providerTimestamp: this.parseProviderTimestamp(body.closeTime),
    };
  }

  private async fetchKlines(binanceSymbol: string, interval: string, limit: number): Promise<Candle[]> {
    const url = `${BASE_URL}/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const rows = await this.request<BinanceKlineRow[] | { code: number; msg: string }>(url);

    if (!Array.isArray(rows)) {
      throw new MarketDataProviderError("invalid_response", "Binance klines response was not an array", PROVIDER_NAME);
    }

    // Binance already returns klines oldest-first - no reversal needed
    // (unlike Twelve Data's newest-first /time_series).
    const parsed: Candle[] = [];
    for (const row of rows) {
      const [openTime, open, high, low, close, volume] = row;
      const o = toFiniteNumber(open);
      const h = toFiniteNumber(high);
      const l = toFiniteNumber(low);
      const c = toFiniteNumber(close);
      const timestamp = this.parseProviderTimestamp(openTime);
      if (o === undefined || h === undefined || l === undefined || c === undefined || !timestamp) continue;
      parsed.push({ datetime: timestamp, open: o, high: h, low: l, close: c, volume: toFiniteNumber(volume) });
    }
    return parsed;
  }

  // Binance's timestamps are unix MILLISECONDS (unlike Twelve Data's unix
  // seconds) - only ever returns an ISO string when it is a finite
  // positive number, never guessed.
  private parseProviderTimestamp(timestampMs?: number): string | undefined {
    if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) return undefined;
    const parsed = new Date(timestampMs);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
}
