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
}

export interface MarketDataProvider {
  readonly name: string;
  /** Whether this provider has everything it needs (API key, etc.) to be called. */
  isConfigured(): boolean;
  getMarketContext(request: MarketContextRequest): Promise<MarketContextResult>;
}

export class MarketDataProviderUnavailableError extends Error {
  constructor(providerName: string) {
    super(`Market data provider "${providerName}" is not configured`);
    this.name = "MarketDataProviderUnavailableError";
  }
}
