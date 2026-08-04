// types/market-data-provider.ts
// Sprint 15D.1 - Market Intelligence Domain Foundation.
// Provider-agnostic abstraction for retrieving market context. Mirrors the
// existing EmbeddingProvider pattern (lib/ai/embedding.interface.ts): a
// single narrow interface, zero concrete implementation, zero vendor
// coupling. No implementation exists yet - see
// services/ai/market-context.service.ts for the not-configured behavior
// when no provider is registered.
//
// Every signal field on MarketContextResult is optional by design: a
// provider fills in only what it actually knows. Downstream consumers
// (MarketContextService) must never replace an absent field with a
// guessed/default value - that would be fabricated market data.
import type { MarketSymbol, TrendDirection } from "./market";
import type { VolatilityLevel } from "./volatility";
import type { LiquidityLevel } from "./liquidity";
import type { RiskLevel } from "./risk";
import type { SentimentLabel } from "./sentiment";

export interface MarketContextRequest {
  symbol: MarketSymbol;
  /** ISO timestamp: context "as of" this time. Providers may ignore this. */
  asOf?: string;
}

/** One attributable fact a provider supplies. Never invented downstream - only ever copied through for citation. */
export interface MarketEvidenceItem {
  claim: string;
  source: string;
  asOf: string;
}

/** Raw provider output. Absent fields mean "this provider has no signal for that", not zero/neutral/default. */
export interface MarketContextResult {
  symbol: MarketSymbol;
  provider: string;
  retrievedAt: string;
  trend?: TrendDirection;
  volatility?: VolatilityLevel;
  liquidity?: LiquidityLevel;
  riskLevel?: RiskLevel;
  sentiment?: SentimentLabel;
  technicalSummary?: string;
  headlines?: string[];
  riskNotes?: string;
  evidence: MarketEvidenceItem[];
  /** Sprint D2.3.S3 - true only when this response was served from MarketDataService's own cache (fresh hit or a resilience stale-fallback) rather than a live provider call this request. Absent/false means live. */
  cached?: boolean;
  /** Sprint D2.3.S3 - age of the cached value in ms, only present when cached === true. */
  cacheAgeMs?: number;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Whether this provider has everything it needs (API key, etc.) to be called. */
  isConfigured(): boolean;
  getMarketContext(request: MarketContextRequest): Promise<MarketContextResult>;
}

// Sprint D2.2 (Phase 6) - an OPTIONAL, additive capability on top of
// MarketDataProvider: a provider that can also return the richer, structured,
// canonical MarketSnapshot (OHLC, volume, market status). Kept separate from
// MarketDataProvider so a spot-only provider (e.g. the Alpha Vantage
// exchange-rate adapter) stays a valid MarketDataProvider without being forced
// to fabricate OHLC it does not have. The central service detects this
// capability at runtime and only routes getSnapshot() to providers that have it.
import type { MarketSnapshot } from "./market-snapshot";

export interface SnapshotProvider {
  readonly name: string;
  isConfigured(): boolean;
  getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot>;
}

export function isSnapshotProvider(value: MarketDataProvider): value is MarketDataProvider & SnapshotProvider {
  return typeof (value as Partial<SnapshotProvider>).getSnapshot === "function";
}

// Sprint D2.2 (Phase 7) - an additive capability for providers that can return
// historical OHLC candles (the input to the real indicator engine). Separate
// from MarketDataProvider/SnapshotProvider so a quote-only provider is never
// forced to fake a series. Candles are returned OLDEST-first.
import type { Candle, TimeSeriesRequest } from "./market-candle";

export interface TimeSeriesProvider {
  readonly name: string;
  isConfigured(): boolean;
  getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]>;
}

export function isTimeSeriesProvider(value: MarketDataProvider): value is MarketDataProvider & TimeSeriesProvider {
  return typeof (value as Partial<TimeSeriesProvider>).getTimeSeries === "function";
}

export class MarketDataProviderUnavailableError extends Error {
  constructor(providerName: string) {
    super(`Market data provider "${providerName}" is not configured`);
    this.name = "MarketDataProviderUnavailableError";
  }
}
