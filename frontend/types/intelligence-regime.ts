// types/intelligence-regime.ts
// Sprint D2.5.2 - Market State & Regime Engine. Regime classifies a
// MarketState deterministically and auditably - see
// services/intelligence/regime/regime.service.ts for the fixed rule set
// and docs/architecture/D2.5.2-market-state-regime-spec.md for the full
// precedence justification. No trained model, no LLM, no probabilistic
// scoring: the same MarketState input always produces the same Regime
// output.
//
// `low-liquidity` is part of this enum for forward compatibility but is
// structurally UNREACHABLE in D2.5.2 - RegimeService never emits it,
// because MarketState.structure never carries real liquidity data (see
// that type's header). This mirrors the exact "defined in the enum,
// unreachable this sprint" pattern D2.5.1 already established for
// AnalysisOutcome's validated/invalidated statuses.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";

export type RegimeType =
  | "trending-bullish"
  | "trending-bearish"
  | "ranging"
  | "breakout"
  | "breakdown"
  | "high-volatility"
  | "low-volatility"
  | "low-liquidity" // structurally unreachable in D2.5.2 - see header comment
  | "transition"
  | "insufficient-data";

export interface Regime {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  regimeType: RegimeType;
  /** 0-100, deterministic - derived from how many precedence conditions were checkable and how decisively the winning condition was met. Never an LLM opinion. */
  confidence: number;
  /** Plain, precise, human-readable statements - e.g. "EMA20 > EMA50", "price above EMA20", "14 candles available (>= 50 required for trend)". Always non-empty. */
  basis: string[];
  /** Only present when a real previous Regime was supplied to RegimeService - never fabricated. Absent (not a guessed "insufficient-data") when no prior regime was given. */
  previousRegime?: RegimeType;
  /** Only present when `previousRegime` was supplied AND the newly-computed regime differs from it - see the service for the exact transition rule. */
  transitionDetectedAt?: string;
  generatedAt: string;
  /** Same Intelligence Engine V2 version as MarketState.pipelineVersion (e.g. "2.0.0") - NOT MARKET_INTELLIGENCE_PIPELINE_VERSION. */
  pipelineVersion: string;
}
