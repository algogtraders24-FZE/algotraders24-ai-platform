// types/real-time-intelligence.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// See docs/architecture/D2.6.5-realtime-intelligence-spec.md for the full
// orchestration contract.
//
// NON-NEGOTIABLE MEANING (repeat this before touching this file): this
// contract exists so that "the AI/LLM must never become the source of
// market facts" is enforced structurally, not just by convention. Every
// field here is either a real, already-verified value (a MarketSnapshot
// field, a D2.5/D2.6 engine output) or an honest data-quality/clarification
// state - never an LLM-generated fact, never an estimated/interpolated
// price, never a silently-downgraded freshness label.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { IntelligenceQuery } from "./intelligence-query";
import type { IntelligenceQueryContext } from "./intelligence-query-context";
import type { IntelligenceEnvelope } from "./intelligence-envelope";
import type { FreshnessStatus } from "./provider-reliability";
import type { MicrostructureSnapshot } from "./microstructure";

/**
 * Five honest states a trader-facing real-time request must be able to
 * report (sprint §2) - deliberately distinct from (but built on top of)
 * D2.6.4's own `FreshnessStatus` ("fresh"|"stale"|"unknown"): this type
 * also distinguishes a same-freshness-window CACHE HIT from a genuine live
 * fetch, and adds "unavailable" for when no real snapshot could be obtained
 * at all. Never silently collapse "cached" or "stale" into "fresh".
 */
export type DataQualityState = "fresh" | "stale" | "cached" | "unknown" | "unavailable";

export interface DataQualityAssessment {
  state: DataQualityState;
  freshnessStatus?: FreshnessStatus;
  cached?: boolean;
  cacheAgeMs?: number;
  /** The real provider that ultimately served this data - undefined only when state is "unavailable". */
  provider?: string;
  providerSymbol?: string;
  fallbackUsed?: boolean;
  /** The real source timestamp of the underlying MarketSnapshot - undefined only when state is "unavailable". */
  timestamp?: string;
  /** Deterministic, human-readable explanation - never empty. */
  basis: string[];
}

/** Aggregate result of comparing two real providers' snapshots for the same instrument (sprint §4) - built by summarizing D2.6.4's own per-field CrossProviderConflict[] via cross-provider-validation.service.ts#summarizeConflicts. Never auto-resolves a disagreement. */
export type CrossProviderValidationStatus = "consistent" | "unresolved-conflict" | "stale" | "insufficient-data";

export interface CrossProviderValidationSummary {
  status: CrossProviderValidationStatus;
  providers: string[];
  basis: string[];
  generatedAt: string;
}

/**
 * "Never guess" (sprint §8): when the trader's question doesn't resolve to
 * exactly one real symbol/timeframe, the orchestrator returns this instead
 * of silently picking one or calling any market-data/intelligence engine.
 */
export type ClarificationReason = "unresolved-symbol" | "ambiguous-symbol" | "unresolved-timeframe";

export interface ClarificationRequirement {
  reason: ClarificationReason;
  message: string;
  /** Real canonical instrument ids/symbols found, when the question was ambiguous - never an arbitrary single pick. */
  candidates?: string[];
}

export type RealTimeIntelligenceStatus = "resolved" | "clarification-required" | "insufficient-data";

/** Sprint §16 - traceable metadata for every real-time intelligence request. Never includes API keys, TOTP secrets, passwords, or raw authorization headers. */
export interface RealTimeIntelligenceObservability {
  requestId: string;
  userId: string;
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;
  providerUsed?: string;
  fallbackUsed?: boolean;
  dataFreshness: DataQualityState;
  pipelineVersion?: string;
  intelligenceEngineVersion?: string;
  presenter?: string;
  responseIntegrityStatus?: ResponseIntegrityStatus;
  generatedAt: string;
}

/** Set by the chat-integration layer after a presenter call - "not-checked" until AIResponseIntegrityService actually runs. */
export type ResponseIntegrityStatus = "not-checked" | "passed" | "failed-fallback-used";

export const REAL_TIME_INTELLIGENCE_ORCHESTRATION_VERSION = "1.0.0";

/**
 * The single verified output of RealTimeIntelligenceService.build() - the
 * one object every downstream presenter (Gemini or the deterministic
 * fallback) and every chat route is allowed to read market/intelligence
 * facts from. `status !== "resolved"` guarantees `envelope`/`queryContext`
 * are both absent - the orchestrator never partially runs the intelligence
 * engines on an unresolved symbol.
 */
export interface VerifiedRealTimeIntelligenceContext {
  status: RealTimeIntelligenceStatus;
  clarification?: ClarificationRequirement;
  query: IntelligenceQuery;
  queryContext?: IntelligenceQueryContext;
  envelope?: IntelligenceEnvelope;
  dataQuality?: DataQualityAssessment;
  crossProviderValidation?: CrossProviderValidationSummary;
  /**
   * Sprint D2.8.7 - real, provider-attributed microstructure evidence
   * (bid/ask, order-book depth, aggressor-mapped trades), reusing D2.8.5's
   * MicrostructureSnapshot type verbatim - never a second, parallel
   * representation. Present only when the caller opted in
   * (`includeMicrostructure`) AND the resolved instrument's canonical
   * provider mapping genuinely proves microstructure-capable-provider
   * coverage for it (currently: Binance for BTCUSD/ETHUSD only - see
   * RealTimeIntelligenceService.build()). Absent for every other
   * instrument and whenever the fetch itself fails - never guessed, never
   * substituted from a different venue. `MicrostructureSnapshot.provider`
   * always identifies the exact venue this evidence came from (e.g.
   * "binance") - it must never be presented as a generic/global market
   * fact.
   */
  microstructure?: MicrostructureSnapshot;
  /** Set only when a real IntelligenceAnalysisRun was persisted (sprint §5) - never set on a clarification/insufficient-data result. */
  analysisRunId?: string;
  observability: RealTimeIntelligenceObservability;
  generatedAt: string;
  orchestrationVersion: string;
}
