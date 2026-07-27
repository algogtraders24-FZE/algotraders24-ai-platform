// types/market-context.ts
// Sprint 15D.1 - Market Intelligence Domain Foundation.
// Provider-agnostic, deterministic, bounded market context types consumed
// by the future AI Trading Intelligence layer. These are assembled BY
// services/ai/market-context.service.ts FROM a MarketDataProvider's raw
// output (types/market-data-provider.ts) - never fabricated, never backed
// by mock data in a production path. This is NOT a Context Manager
// replacement: a MarketContext is meant to be serialized into Context
// Manager's existing ragContext/systemInstructions string inputs by a
// future caller, exactly like knowledge-base RAG context is today.
//
// Reuses existing scalar types (MarketSymbol, TrendDirection,
// SentimentLabel, VolatilityLevel, LiquidityLevel, RiskLevel) rather than
// redefining them - see the Sprint 15D architecture audit for the
// duplicate-type risk this avoids.
//
// Every inferred/derived field is optional: absence means "no evidence for
// this", never a guessed default (see MarketContextService).
import type { MarketSymbol, TrendDirection } from "./market";
import type { SentimentLabel } from "./sentiment";
import type { VolatilityLevel } from "./volatility";
import type { LiquidityLevel } from "./liquidity";
import type { RiskLevel } from "./risk";

/** A single, attributable fact backing part of an analysis - only ever copied from a provider's raw output, never inferred. */
export interface Evidence {
  claim: string;
  source: string;
  asOf: string;
}

/** Confidence is always accompanied by the evidence it's derived from - never a bare number alone. */
export interface Confidence {
  score: number; // 0-100; 0 when there is no evidence at all
  basis: Evidence[];
}

export interface MarketState {
  symbol: MarketSymbol;
  trend?: TrendDirection;
  volatility?: VolatilityLevel;
  liquidity?: LiquidityLevel;
  evidence: Evidence[];
}

export interface TechnicalContext {
  symbol: MarketSymbol;
  summary?: string;
  evidence: Evidence[];
}

export interface NewsContext {
  symbol: MarketSymbol;
  /** Empty array means "no news evidence found", not "no news happened". */
  headlines: string[];
  evidence: Evidence[];
}

export interface RiskContext {
  symbol: MarketSymbol;
  level?: RiskLevel;
  notes?: string;
  evidence: Evidence[];
}

/** The bounded, deterministic bundle handed to a future AI layer as input. */
export interface MarketContext {
  symbol: MarketSymbol;
  state: MarketState;
  technical: TechnicalContext;
  news: NewsContext;
  risk: RiskContext;
  confidence: Confidence;
  sentiment?: SentimentLabel;
  generatedAt: string;
}
