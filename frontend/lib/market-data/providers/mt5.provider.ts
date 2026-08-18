// lib/market-data/providers/mt5.provider.ts
// Sprint: MT5 (Exness) Live Data Bridge. Implements the existing,
// UNMODIFIED MarketDataProvider/SnapshotProvider/TimeSeriesProvider
// interfaces exactly like binance.provider.ts (the template this file
// mirrors) - a drop-in for MarketDataService's provider array, no changes
// above the provider layer.
//
// This adapter does NOT talk to MetaTrader5 directly - the MT5 Python API
// only works against a locally-running MT5 desktop terminal (local IPC,
// no real network protocol), so it cannot run inside this Next.js app on
// Vercel. Instead it calls a small, separate read-only HTTP bridge
// (mt5-bridge/bridge.py, this repo, deployed on the user's own Windows VPS
// next to their live Exness MT5 terminal) over HTTPS with a shared-secret
// Bearer token. See mt5-bridge/README.md for the full deployment runbook.
//
// Hard boundary, mirrored from the bridge itself: this adapter only ever
// calls GET /quote and GET /candles - there is no order-placement,
// modification, or account-mutating call anywhere in this file, and never
// will be. Read-only market data only.
//
// Symbol source of truth: like Binance (D2.6.3), this adapter has no
// legacy symbol table - it reads its mapping directly from
// lib/market-data/instrument-catalog.ts via mappingsForProvider("mt5"),
// a single source of truth, never a second copy to keep in sync.
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
import { getMarket } from "../market-registry";
import { mappingsForProvider } from "../instrument-catalog";
import { loadMt5BridgeEnv, type Mt5BridgeEnv } from "../env";
import { MarketDataProviderError } from "../errors";
import { TtlCache, systemClock, type Clock } from "../cache";

const PROVIDER_NAME = "mt5";
const DEFAULT_QUOTE_CACHE_TTL_MS = 15_000;
const DEFAULT_CANDLE_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_INTERVAL = "1h";
const DEFAULT_OUTPUT_SIZE = 100;

interface SymbolSpec {
  mt5Symbol: string;
  quoteCurrency: string;
  assetClass: MarketCategory;
}

function getSymbolMap(): Record<string, SymbolSpec> {
  return Object.fromEntries(
    mappingsForProvider(PROVIDER_NAME).map(({ instrument, mapping }) => [
      instrument.id,
      { mt5Symbol: mapping.providerSymbol, quoteCurrency: instrument.currency ?? "USD", assetClass: instrument.marketCategory ?? "commodities" },
    ]),
  );
}

/** Structured, provider-neutral quote parsed from the bridge's /quote response. Never leaves this file. */
export interface ParsedMt5Quote {
  bid: number;
  ask: number;
  last?: number;
  volume?: number;
  providerTimestamp: string;
}

interface Mt5BridgeQuoteResponse {
  symbol?: string;
  mt5Symbol?: string;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
  time?: string;
  detail?: string; // FastAPI's HTTPException error shape
}

interface Mt5BridgeCandleRow {
  datetime?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

interface Mt5BridgeCandlesResponse {
  candles?: Mt5BridgeCandleRow[];
  detail?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network - identical pattern to every other provider adapter in this codebase. */
export type Mt5BridgeFetch = (url: string, init: { headers: Record<string, string> }) => Promise<FetchLikeResponse>;

export interface Mt5ProviderOptions {
  cacheTtlMs?: number;
  candleCacheTtlMs?: number;
  clock?: Clock;
  fetchImpl?: Mt5BridgeFetch;
  /** Test-only override - production always reads from loadMt5BridgeEnv(). */
  env?: Mt5BridgeEnv | null;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class Mt5Provider implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = PROVIDER_NAME;
  private readonly env: Mt5BridgeEnv | null;
  private readonly quoteCache: TtlCache<ParsedMt5Quote>;
  private readonly candleCache: TtlCache<Candle[]>;
  private readonly clock: Clock;
  private readonly fetchImpl: Mt5BridgeFetch;

  constructor(options: Mt5ProviderOptions = {}) {
    this.env = options.env !== undefined ? options.env : loadMt5BridgeEnv();
    this.clock = options.clock ?? systemClock;
    this.quoteCache = new TtlCache<ParsedMt5Quote>(options.cacheTtlMs ?? DEFAULT_QUOTE_CACHE_TTL_MS, this.clock);
    this.candleCache = new TtlCache<Candle[]>(options.candleCacheTtlMs ?? DEFAULT_CANDLE_CACHE_TTL_MS, this.clock);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as Mt5BridgeFetch);
  }

  isConfigured(): boolean {
    return this.env !== null;
  }

  /** Canonical symbols this provider maps today, per the catalog - exposed so callers/registries can advertise coverage without reaching into the symbol map directly. */
  supportedSymbols(): string[] {
    return Object.keys(getSymbolMap());
  }

  private resolveSymbol(symbol: string): SymbolSpec {
    const spec = getSymbolMap()[symbol];
    if (!spec) {
      throw new MarketDataProviderError(
        "unsupported_symbol",
        `Symbol "${symbol}" is not mapped for ${PROVIDER_NAME} (supported: ${Object.keys(getSymbolMap()).join(", ")})`,
        PROVIDER_NAME,
      );
    }
    return spec;
  }

  private authHeaders(env: Mt5BridgeEnv): Record<string, string> {
    // The bridge secret never appears in a URL (would leak into logs/
    // history) - always the Authorization header, matching this
    // platform's own cron-secret convention (lib/intelligence/cron-auth.ts).
    return { Authorization: `Bearer ${env.secret}` };
  }

  private async fetchQuote(env: Mt5BridgeEnv, mt5Symbol: string): Promise<ParsedMt5Quote> {
    const url = `${env.bridgeUrl}/quote?symbol=${encodeURIComponent(mt5Symbol)}`;
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url, { headers: this.authHeaders(env) });
    } catch (error) {
      // Never let the raw error (which could echo the bridge URL) escape
      // unwrapped - same discipline as every other provider adapter.
      throw new MarketDataProviderError("http_error", "Failed to reach the MT5 bridge", PROVIDER_NAME, error);
    }

    if (res.status === 401) {
      throw new MarketDataProviderError("auth", "MT5 bridge rejected the configured secret", PROVIDER_NAME);
    }
    if (res.status === 404) {
      throw new MarketDataProviderError("unsupported_symbol", `MT5 bridge has no live quote for "${mt5Symbol}"`, PROVIDER_NAME);
    }
    if (!res.ok) {
      throw new MarketDataProviderError("http_error", `MT5 bridge returned HTTP ${res.status}`, PROVIDER_NAME);
    }

    let body: Mt5BridgeQuoteResponse;
    try {
      body = (await res.json()) as Mt5BridgeQuoteResponse;
    } catch (error) {
      throw new MarketDataProviderError("invalid_response", "MT5 bridge response was not valid JSON", PROVIDER_NAME, error);
    }

    const bid = toFiniteNumber(body.bid);
    const ask = toFiniteNumber(body.ask);
    if (bid === undefined || ask === undefined || !body.time) {
      throw new MarketDataProviderError("invalid_response", "MT5 bridge quote response is missing bid/ask/time", PROVIDER_NAME);
    }

    return { bid, ask, last: toFiniteNumber(body.last), volume: toFiniteNumber(body.volume), providerTimestamp: body.time };
  }

  private async getParsedQuote(env: Mt5BridgeEnv, mt5Symbol: string): Promise<ParsedMt5Quote> {
    let quote = this.quoteCache.get(mt5Symbol);
    if (!quote) {
      quote = await this.fetchQuote(env, mt5Symbol);
      this.quoteCache.set(mt5Symbol, quote);
    }
    return quote;
  }

  private requireEnv(): Mt5BridgeEnv {
    if (!this.env) {
      throw new MarketDataProviderError("unconfigured", `${PROVIDER_NAME} is not configured (missing MT5_BRIDGE_URL/MT5_BRIDGE_SECRET)`, PROVIDER_NAME);
    }
    return this.env;
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    const spec = this.resolveSymbol(request.symbol);
    const env = this.requireEnv();
    const quote = await this.getParsedQuote(env, spec.mt5Symbol);
    const retrievedAt = new Date(this.clock.now()).toISOString();
    const price = quote.last && quote.last > 0 ? quote.last : (quote.bid + quote.ask) / 2;

    const evidence: MarketEvidenceItem[] = [
      { claim: `Spot price: ${price} ${spec.quoteCurrency} (live MT5 bid/ask: ${quote.bid}/${quote.ask})`, source: PROVIDER_NAME, asOf: quote.providerTimestamp },
    ];

    return { symbol: request.symbol, provider: PROVIDER_NAME, retrievedAt, evidence };
  }

  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const spec = this.resolveSymbol(request.symbol);
    const env = this.requireEnv();
    const quote = await this.getParsedQuote(env, spec.mt5Symbol);
    const retrievedAt = new Date(this.clock.now()).toISOString();
    // A forex/CFD instrument's "last traded price" is often 0/absent (no
    // central exchange tape) - the honest, industry-standard fallback is
    // the real bid/ask midpoint, a genuine derived value from two live
    // numbers, never a guess. Matches D2.8.1's own "spread is a pure
    // derivation, computed in exactly one place" discipline in spirit.
    const price = quote.last && quote.last > 0 ? quote.last : (quote.bid + quote.ask) / 2;
    // MT5's tick response carries no explicit market-open/closed flag in
    // this bridge's current shape - "unknown" is the honest reading,
    // never guessed as "open" the way Binance's genuinely-24/7 crypto
    // market can be (see binance.provider.ts's own comment on this).
    const marketStatus: MarketStatus = "unknown";

    return {
      symbol: request.symbol,
      name: getMarket(request.symbol)?.name,
      assetClass: spec.assetClass,
      price,
      bid: quote.bid,
      ask: quote.ask,
      quoteCurrency: spec.quoteCurrency,
      timestamp: quote.providerTimestamp,
      timezone: "UTC",
      marketStatus,
      provider: PROVIDER_NAME,
      retrievedAt,
      providerSymbol: spec.mt5Symbol,
    };
  }

  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
    const spec = this.resolveSymbol(request.symbol);
    const env = this.requireEnv();
    const interval = request.interval ?? DEFAULT_INTERVAL;
    const outputSize = request.outputSize ?? DEFAULT_OUTPUT_SIZE;
    const cacheKey = `${spec.mt5Symbol}|${interval}|${outputSize}`;

    let candles = this.candleCache.get(cacheKey);
    if (!candles) {
      candles = await this.fetchCandles(env, spec.mt5Symbol, interval, outputSize);
      this.candleCache.set(cacheKey, candles);
    }
    return candles;
  }

  private async fetchCandles(env: Mt5BridgeEnv, mt5Symbol: string, interval: string, outputSize: number): Promise<Candle[]> {
    const url = `${env.bridgeUrl}/candles?symbol=${encodeURIComponent(mt5Symbol)}&interval=${encodeURIComponent(interval)}&count=${outputSize}`;
    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(url, { headers: this.authHeaders(env) });
    } catch (error) {
      throw new MarketDataProviderError("http_error", "Failed to reach the MT5 bridge", PROVIDER_NAME, error);
    }

    if (res.status === 401) {
      throw new MarketDataProviderError("auth", "MT5 bridge rejected the configured secret", PROVIDER_NAME);
    }
    if (res.status === 400) {
      throw new MarketDataProviderError("invalid_response", `MT5 bridge does not support interval "${interval}"`, PROVIDER_NAME);
    }
    if (res.status === 404) {
      throw new MarketDataProviderError("unsupported_symbol", `MT5 bridge has no candle data for "${mt5Symbol}"`, PROVIDER_NAME);
    }
    if (!res.ok) {
      throw new MarketDataProviderError("http_error", `MT5 bridge returned HTTP ${res.status}`, PROVIDER_NAME);
    }

    let body: Mt5BridgeCandlesResponse;
    try {
      body = (await res.json()) as Mt5BridgeCandlesResponse;
    } catch (error) {
      throw new MarketDataProviderError("invalid_response", "MT5 bridge response was not valid JSON", PROVIDER_NAME, error);
    }

    const rows = body.candles ?? [];
    return rows
      .filter(
        (row): row is Required<Mt5BridgeCandleRow> =>
          typeof row.datetime === "string" &&
          typeof row.open === "number" &&
          typeof row.high === "number" &&
          typeof row.low === "number" &&
          typeof row.close === "number",
      )
      .map((row) => ({ datetime: row.datetime, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume ?? 0 }));
  }
}
