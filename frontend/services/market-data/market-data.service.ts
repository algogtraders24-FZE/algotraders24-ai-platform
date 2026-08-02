// services/market-data/market-data.service.ts
// Sprint D2.2 (Phase 3) - the single, centralized entry point for market
// data. Every module (Market Intelligence, Dashboard, AI Assistant, future
// research) should obtain market data through this service, never by calling
// a provider - let alone a vendor API - directly.
//
// It deliberately *implements* the existing MarketDataProvider interface, so
// it is itself a drop-in wherever a single provider is used today (e.g. the
// Market Intelligence pipeline). Swapping a raw AlphaVantageProvider for this
// service adds Twelve Data as primary and Alpha Vantage as automatic fallback
// with zero changes above the injection point - the vendor-independence goal.
//
// Responsibilities kept here (Phase 3): provider selection (priority order),
// service-level caching, centralized typed-error handling, and fallback
// across providers. Per-call resilience wrappers (timeout, retry, backoff)
// are Phase 4 and will wrap each provider call from inside `attempt()` without
// changing this file's selection/fallback shape. The richer shared
// MarketSnapshot model is Phase 6.
import type {
  MarketDataProvider,
  SnapshotProvider,
  TimeSeriesProvider,
  MarketContextRequest,
  MarketContextResult,
} from "@/types/market-data-provider";
import { isSnapshotProvider, isTimeSeriesProvider } from "@/types/market-data-provider";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { Candle, TimeSeriesRequest } from "@/types/market-candle";
import { MarketDataProviderError, type MarketDataErrorKind } from "@/lib/market-data/errors";
import { withReliability, type ReliabilityOptions } from "@/lib/market-data/reliability";
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import { TwelveDataProvider } from "@/lib/market-data/providers/twelve-data.provider";
import { AlphaVantageProvider } from "@/lib/market-data/providers/alpha-vantage.provider";

const SERVICE_NAME = "market-data";
const DEFAULT_CACHE_TTL_MS = 30_000;

export interface MarketDataServiceOptions {
  /** Providers in priority order. Default: [Twelve Data (primary), Alpha Vantage (fallback)]. */
  providers?: MarketDataProvider[];
  cacheTtlMs?: number;
  clock?: Clock;
  /** Per-provider-call resilience (timeout/retry/backoff). See lib/market-data/reliability.ts. */
  reliability?: ReliabilityOptions;
}

export class MarketDataService implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = SERVICE_NAME;
  private readonly providers: MarketDataProvider[];
  private readonly cache: TtlCache<MarketContextResult>;
  private readonly snapshotCache: TtlCache<MarketSnapshot>;
  private readonly clock: Clock;
  private readonly reliability: ReliabilityOptions;

  constructor(options: MarketDataServiceOptions = {}) {
    // Priority order is the provider-priority contract: Twelve Data first,
    // Alpha Vantage as the preserved fallback. Callers may override entirely
    // (e.g. tests inject fakes) but the default encodes the documented policy.
    this.providers = options.providers ?? [new TwelveDataProvider(), new AlphaVantageProvider()];
    this.clock = options.clock ?? systemClock;
    const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache = new TtlCache<MarketContextResult>(ttl, this.clock);
    this.snapshotCache = new TtlCache<MarketSnapshot>(ttl, this.clock);
    this.reliability = options.reliability ?? {};
  }

  /** True when at least one provider is ready to serve - the service is usable if any vendor is configured. */
  isConfigured(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  /** Names of currently-configured providers, in priority order - for diagnostics/health, never exposes keys. */
  configuredProviders(): string[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.name);
  }

  /**
   * Returns market context for a symbol, trying each configured provider in
   * priority order and falling back to the next on any typed provider error
   * (unconfigured, unsupported symbol, rate limit, transport, invalid
   * response). The first provider to succeed wins and its result is cached.
   *
   * Never disguises a total failure: if no provider can serve the symbol, a
   * single aggregate MarketDataProviderError is thrown (kind chosen from the
   * attempts, cause = every underlying error). An UNEXPECTED (non-typed)
   * error is never swallowed - it propagates immediately so a real bug can't
   * hide behind "fallback".
   */
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    const cached = this.cache.get(request.symbol);
    if (cached) return cached;

    const errors: MarketDataProviderError[] = [];
    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        const result = await this.attempt(provider, request);
        this.cache.set(request.symbol, result);
        return result;
      } catch (error) {
        if (error instanceof MarketDataProviderError) {
          errors.push(error);
          continue; // fall back to the next provider
        }
        throw error; // unexpected - never swallow a genuine bug
      }
    }

    throw this.aggregateError(request.symbol, errors);
  }

  /**
   * Returns the canonical MarketSnapshot for a symbol. Same priority-order
   * selection, per-call reliability, and fallback as getMarketContext, but
   * only providers that actually implement SnapshotProvider are eligible - a
   * spot-only provider (Alpha Vantage) is skipped rather than forced to
   * fabricate OHLC. If no snapshot-capable provider can serve the symbol, a
   * single aggregate error is thrown.
   */
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const cached = this.snapshotCache.get(request.symbol);
    if (cached) return cached;

    const errors: MarketDataProviderError[] = [];
    for (const provider of this.providers) {
      if (!isSnapshotProvider(provider)) continue; // capability, not an error worth reporting
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        const snapshot = await withReliability(() => provider.getSnapshot(request), provider.name, this.reliability);
        this.snapshotCache.set(request.symbol, snapshot);
        return snapshot;
      } catch (error) {
        if (error instanceof MarketDataProviderError) {
          errors.push(error);
          continue;
        }
        throw error;
      }
    }
    throw this.aggregateError(request.symbol, errors);
  }

  /**
   * Returns historical OHLC candles (oldest-first) for the indicator engine,
   * routed only to time-series-capable providers with the same priority order,
   * per-call reliability, and fallback. Candles are not cached at the service
   * level (the providers cache them on a longer TTL); this keeps one source of
   * truth for candle freshness. Throws an aggregate error if none can serve it.
   */
  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
    const errors: MarketDataProviderError[] = [];
    for (const provider of this.providers) {
      if (!isTimeSeriesProvider(provider)) continue;
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        return await withReliability(() => provider.getTimeSeries(request), provider.name, this.reliability);
      } catch (error) {
        if (error instanceof MarketDataProviderError) {
          errors.push(error);
          continue;
        }
        throw error;
      }
    }
    throw this.aggregateError(request.symbol, errors);
  }

  // Single seam where a provider call happens. Sprint D2.2 Phase 4: every
  // call is wrapped with a per-attempt timeout and bounded exponential-backoff
  // retry on transient errors (http_error/timeout). A non-transient failure
  // (rate_limit/auth/unsupported/invalid) fails fast here so the selection
  // loop above can fall back to the next provider immediately. Resilience thus
  // lives in exactly one place, for every provider, without touching the
  // selection/fallback loop.
  private async attempt(provider: MarketDataProvider, request: MarketContextRequest): Promise<MarketContextResult> {
    return withReliability(() => provider.getMarketContext(request), provider.name, this.reliability);
  }

  private aggregateError(symbol: string, errors: MarketDataProviderError[]): MarketDataProviderError {
    // Prefer the most actionable kind: if every provider was simply
    // unconfigured, that's the honest headline; otherwise surface the last
    // real attempt's kind (the deepest fallback that still failed).
    const realErrors = errors.filter((e) => e.kind !== "unconfigured");
    let kind: MarketDataErrorKind;
    if (realErrors.length === 0) kind = "unconfigured";
    else if (realErrors.every((e) => e.kind === "unsupported_symbol")) kind = "unsupported_symbol";
    else kind = realErrors[realErrors.length - 1].kind;

    const tried = errors.map((e) => `${e.provider}: ${e.kind}`).join("; ");
    return new MarketDataProviderError(
      kind,
      `No provider could serve "${symbol}" (${tried || "no providers configured"})`,
      SERVICE_NAME,
      errors,
    );
  }
}
