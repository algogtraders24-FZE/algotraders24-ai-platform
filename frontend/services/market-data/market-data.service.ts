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
import type { Candle, TimeSeriesRequest, TimeSeriesResult } from "@/types/market-candle";
import { MarketDataProviderError, type MarketDataErrorKind } from "@/lib/market-data/errors";
import { withReliability, type ReliabilityOptions } from "@/lib/market-data/reliability";
import { TtlCache, systemClock, type Clock } from "@/lib/market-data/cache";
import { TwelveDataProvider } from "@/lib/market-data/providers/twelve-data.provider";
import { AlphaVantageProvider } from "@/lib/market-data/providers/alpha-vantage.provider";
// Sprint D2.6.3 - Binance/Angel One appended to the DEFAULT provider
// array (never inserted before the existing two, never replacing them).
// This is a deliberate, backward-compatible priority choice: every
// symbol Twelve Data/Alpha Vantage already served (EURUSD, XAUUSD, ...)
// keeps its exact existing selection order and behavior. Only for the
// new instruments these two adapters uniquely cover (BTCUSD/ETHUSD/
// SOLUSD/XRPUSD get a 3rd real fallback via Binance; NIFTY50/RELIANCE
// are served for the first time, via Angel One) does the array's extra
// length matter at all.
import { BinanceProvider } from "@/lib/market-data/providers/binance.provider";
import { AngelOneProvider } from "@/lib/market-data/providers/angel-one.provider";
import { ProviderHealthMonitor, type ProviderHealthSnapshot } from "@/lib/market-data/health-monitor";
import { logger } from "@/services/backend/Logger";
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. orderProviders() is a pure function over this
// service's OWN existing ProviderHealthMonitor snapshots (this.health,
// unchanged) - no second health-tracking system. Opt-in via
// `smartFallback` (default false, so every EXISTING caller/test that
// constructs a MarketDataService directly is completely unaffected);
// the real shared production singleton (services/market-data/shared-
// instance.ts) explicitly turns it on.
import { orderProviders } from "./provider-reliability.service";
import type { MarketDataCapability } from "@/types/canonical-instrument";

const SERVICE_NAME = "market-data";
const DEFAULT_CACHE_TTL_MS = 30_000;
// Sprint D2.3.S3 - how far past its normal TTL a cache entry can still be
// served as a last-resort fallback when every provider fails. Distinct from
// DEFAULT_CACHE_TTL_MS: that's "how long is this fresh", this is "how stale
// is still better than a hard failure".
const DEFAULT_STALE_FALLBACK_MS = 5 * 60_000;

// Sprint D2.8.1 - the ONLY place spread is ever computed. `ask - bid`, and
// only when both are present and ask >= bid (the winning provider's own
// getSnapshot() has already validated bid/ask individually - this is a
// second, cheap sanity check against the pair, not a duplicate of that
// validation). Never derived from price/candles, never a fallback/guess -
// a snapshot with no valid bid/ask pair simply has no `spread` field.
function withDerivedSpread(snapshot: MarketSnapshot): MarketSnapshot {
  if (snapshot.bid === undefined || snapshot.ask === undefined || snapshot.ask < snapshot.bid) return snapshot;
  return { ...snapshot, spread: snapshot.ask - snapshot.bid };
}

export interface MarketDataServiceOptions {
  /** Providers in priority order. Default: [Twelve Data (primary), Alpha Vantage, Binance, Angel One (D2.6.3)]. */
  providers?: MarketDataProvider[];
  cacheTtlMs?: number;
  /** Sprint D2.3.S3 - grace window past cacheTtlMs a stale entry may still be served when every provider fails. */
  staleFallbackMs?: number;
  clock?: Clock;
  /** Per-provider-call resilience (timeout/retry/backoff). See lib/market-data/reliability.ts. */
  reliability?: ReliabilityOptions;
  /** Sprint D2.6.4 - when true, each fetch reorders the configured provider list by real recorded reliability (see provider-reliability.service.ts#orderProviders) before the existing selection loop runs. Default false - zero behavior change unless explicitly enabled. */
  smartFallback?: boolean;
}

export class MarketDataService implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = SERVICE_NAME;
  private readonly providers: MarketDataProvider[];
  private readonly cache: TtlCache<MarketContextResult>;
  private readonly snapshotCache: TtlCache<MarketSnapshot>;
  private readonly clock: Clock;
  private readonly reliability: ReliabilityOptions;
  private readonly cacheTtlMs: number;
  private readonly staleFallbackMs: number;
  private readonly smartFallback: boolean;
  private readonly health = new ProviderHealthMonitor();
  private readonly log = logger.child("market-data");

  constructor(options: MarketDataServiceOptions = {}) {
    // Priority order is the provider-priority contract: Twelve Data first,
    // Alpha Vantage as the preserved fallback, then Binance and Angel One
    // (Sprint D2.6.3) appended - see the import comment above for why
    // this ordering is deliberately backward-compatible. Callers may
    // override entirely (e.g. tests inject fakes) but the default
    // encodes the documented policy.
    this.providers = options.providers ?? [new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider()];
    this.clock = options.clock ?? systemClock;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache = new TtlCache<MarketContextResult>(this.cacheTtlMs, this.clock);
    this.snapshotCache = new TtlCache<MarketSnapshot>(this.cacheTtlMs, this.clock);
    this.reliability = options.reliability ?? {};
    this.staleFallbackMs = options.staleFallbackMs ?? DEFAULT_STALE_FALLBACK_MS;
    this.smartFallback = options.smartFallback ?? false;
  }

  // Sprint D2.6.4 - the single seam every fetch method reads its
  // candidate provider list through. Returns `this.providers` completely
  // UNCHANGED (same order, same array reference semantics) when
  // smartFallback is off - the only way this ever alters existing
  // behavior is by explicit opt-in.
  private orderedProviders(symbol: string, capability: MarketDataCapability): MarketDataProvider[] {
    if (!this.smartFallback) return this.providers;
    return orderProviders({ providers: this.providers, symbol, capability, healthSnapshots: this.health.allSnapshots(), nowMs: this.clock.now() });
  }

  /** True when at least one provider is ready to serve - the service is usable if any vendor is configured. */
  isConfigured(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  /** Names of currently-configured providers, in priority order - for diagnostics/health, never exposes keys. */
  configuredProviders(): string[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.name);
  }

  /** Sprint D2.3.S3 - per-provider health state (healthy/degraded/rate_limited/offline), from real recorded outcomes only. */
  healthReport(): ProviderHealthSnapshot[] {
    return this.health.allSnapshots();
  }

  /** Sprint D2.3.S3 - whether any snapshot cache entry exists for a symbol, regardless of freshness. Diagnostic only, for the failure DTO's `cached` flag - never exposes the value itself. */
  hasCacheEntry(symbol: string): boolean {
    return this.snapshotCache.has(symbol);
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
    const fresh = this.cache.getStale(request.symbol, this.cacheTtlMs);
    if (fresh) return { ...fresh.value, cached: true, cacheAgeMs: fresh.ageMs };

    const errors: MarketDataProviderError[] = [];
    for (const provider of this.orderedProviders(request.symbol, "quote")) {
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        const result = await this.recordedAttempt(provider, request.symbol, () => this.attempt(provider, request));
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

    // Sprint D2.3.S3 - last resort before a hard failure: a stale-but-in-
    // grace-window cache entry, honestly stamped as such. Never presented as
    // live - callers (routes/UI) are expected to check `cached`.
    const stale = this.cache.getStale(request.symbol, this.staleFallbackMs);
    if (stale) {
      this.log.warn("stale-cache-fallback served", { symbol: request.symbol, ageMs: stale.ageMs });
      return { ...stale.value, cached: true, cacheAgeMs: stale.ageMs };
    }

    this.log.error("all providers failed", { symbol: request.symbol, attempted: errors.map((e) => `${e.provider}:${e.kind}`) });
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
    const fresh = this.snapshotCache.getStale(request.symbol, this.cacheTtlMs);
    if (fresh) return { ...fresh.value, cached: true, cacheAgeMs: fresh.ageMs };

    const errors: MarketDataProviderError[] = [];
    for (const provider of this.orderedProviders(request.symbol, "quote")) {
      if (!isSnapshotProvider(provider)) continue; // capability, not an error worth reporting
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        const rawSnapshot = await this.recordedAttempt(provider, request.symbol, () =>
          withReliability(() => provider.getSnapshot(request), provider.name, this.reliability),
        );
        // Sprint D2.8.1 - spread is a pure derivation of whatever bid/ask
        // the winning provider actually supplied, computed in exactly one
        // place so every current and future SnapshotProvider gets it for
        // free without duplicating the calculation per-provider.
        const snapshot = withDerivedSpread(rawSnapshot);
        // Sprint D2.6.3 - fallbackUsed provenance: true only when a real
        // failure (never a merely "unconfigured" skip) from an
        // earlier-priority provider preceded this success.
        const fallbackUsed = errors.some((e) => e.kind !== "unconfigured");
        const withProvenance: MarketSnapshot = fallbackUsed ? { ...snapshot, fallbackUsed: true } : snapshot;
        this.snapshotCache.set(request.symbol, withProvenance);
        return withProvenance;
      } catch (error) {
        if (error instanceof MarketDataProviderError) {
          errors.push(error);
          continue;
        }
        throw error;
      }
    }

    const stale = this.snapshotCache.getStale(request.symbol, this.staleFallbackMs);
    if (stale) {
      this.log.warn("stale-cache-fallback served", { symbol: request.symbol, ageMs: stale.ageMs });
      return { ...stale.value, cached: true, cacheAgeMs: stale.ageMs };
    }

    this.log.error("all providers failed", { symbol: request.symbol, attempted: errors.map((e) => `${e.provider}:${e.kind}`) });
    throw this.aggregateError(request.symbol, errors);
  }

  /**
   * Returns historical OHLC candles (oldest-first) for the indicator engine,
   * routed only to time-series-capable providers with the same priority order,
   * per-call reliability, and fallback. Candles are not cached at the service
   * level (the providers cache them on a longer TTL); this keeps one source of
   * truth for candle freshness. Throws an aggregate error if none can serve it.
   *
   * Sprint D2.7.3 - a thin wrapper around getTimeSeriesWithProvenance() below,
   * so every existing caller (RealTimeIntelligenceService, the hypothesis
   * outcome evaluator, the trading-copilot service) keeps its exact existing
   * signature/behavior/errors, byte-for-byte, while a new caller that wants
   * provenance (the native chart's candles route) can ask for it without a
   * second provider-selection loop.
   */
  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
    const result = await this.getTimeSeriesWithProvenance(request);
    return result.candles;
  }

  /**
   * Sprint D2.7.3 - the SAME selection loop as getTimeSeries() (never a
   * second/duplicated one, never a changed provider order), additionally
   * reporting which provider actually served the candles and whether a
   * higher-priority provider had to be skipped first - the identical
   * `fallbackUsed` provenance rule getSnapshot() already established
   * (D2.6.3): true only when a REAL failure (never a merely "unconfigured"
   * skip) from an earlier-priority provider preceded this success.
   */
  async getTimeSeriesWithProvenance(request: TimeSeriesRequest): Promise<TimeSeriesResult> {
    const errors: MarketDataProviderError[] = [];
    for (const provider of this.orderedProviders(request.symbol, "candles")) {
      if (!isTimeSeriesProvider(provider)) continue;
      if (!provider.isConfigured()) {
        errors.push(new MarketDataProviderError("unconfigured", `${provider.name} is not configured`, provider.name));
        continue;
      }
      try {
        const candles = await this.recordedAttempt(provider, request.symbol, () =>
          withReliability(() => provider.getTimeSeries(request), provider.name, this.reliability),
        );
        const fallbackUsed = errors.some((e) => e.kind !== "unconfigured");
        return { candles, provider: provider.name, fallbackUsed };
      } catch (error) {
        if (error instanceof MarketDataProviderError) {
          errors.push(error);
          continue;
        }
        throw error;
      }
    }
    // Sprint D2.3.S3 - candles are deliberately NOT part of the stale-cache-
    // fallback resilience path: they aren't cached at this service level at
    // all (see the method comment above), so there is nothing to fall back
    // to here. This is a documented non-goal, not an oversight.
    this.log.error("all providers failed", { symbol: request.symbol, attempted: errors.map((e) => `${e.provider}:${e.kind}`) });
    throw this.aggregateError(request.symbol, errors);
  }

  // Single seam where a MarketContext provider call happens. Sprint D2.2
  // Phase 4: every call is wrapped with a per-attempt timeout and bounded
  // exponential-backoff retry (Sprint D2.3.S3: now including transient
  // rate-limit/429 responses, not just http_error/timeout - see
  // lib/market-data/reliability.ts). A non-retryable failure (auth/
  // unsupported_symbol/invalid_response/unconfigured) fails fast here so the
  // selection loop above can fall back to the next provider immediately.
  // Resilience thus lives in exactly one place, for every provider, without
  // touching the selection/fallback loop.
  private async attempt(provider: MarketDataProvider, request: MarketContextRequest): Promise<MarketContextResult> {
    return withReliability(() => provider.getMarketContext(request), provider.name, this.reliability);
  }

  // Sprint D2.3.S3 - shared timing/health/logging wrapper around a single
  // provider call, used by all three public methods so recording behavior
  // lives in exactly one place. Never changes what op() returns or throws -
  // purely observes it.
  private async recordedAttempt<T>(provider: MarketDataProvider, symbol: string, op: () => Promise<T>): Promise<T> {
    const startedAt = this.clock.now();
    try {
      const result = await op();
      const latencyMs = this.clock.now() - startedAt;
      this.health.recordSuccess(provider.name, latencyMs);
      this.log.info("provider attempt succeeded", { provider: provider.name, symbol, latencyMs });
      return result;
    } catch (error) {
      const latencyMs = this.clock.now() - startedAt;
      if (error instanceof MarketDataProviderError) {
        this.health.recordFailure(provider.name, error.kind);
        const fallback = this.providers[this.providers.indexOf(provider) + 1]?.name ?? "none";
        this.log.warn("provider attempt failed", { provider: provider.name, symbol, kind: error.kind, fallback, latencyMs });
      }
      throw error;
    }
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
