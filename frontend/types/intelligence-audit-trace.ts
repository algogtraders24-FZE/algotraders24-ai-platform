// types/intelligence-audit-trace.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. This is an AUDIT/PROVENANCE contract, NOT a second
// reasoning engine and NOT a new intelligence computation. Every field
// here is either a direct, immutable copy of an already-computed D2.5.x/
// D2.6.x value, or a real, deterministic classification derived from one.
//
// NON-NEGOTIABLE MEANING (repeat before touching this file): a trader
// must never receive an answer that cannot be traced back to the
// verified intelligence available at the time of analysis. This trace
// is what makes that claim checkable after the fact - it records what
// the system KNEW THEN, never what the market looks like NOW. Viewing an
// old trace must never recompute or refresh anything (see
// services/intelligence/audit/audit-trace.service.ts's header for the
// historical-immutability discipline this type exists to support).
//
// NEVER store: API keys, TOTP secrets, passwords, raw authorization
// headers, or a provider's raw/sensitive error text. Only closed-
// vocabulary diagnostic categories (PresenterFailureCategory, etc.).
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { IntelligenceQueryType } from "./intelligence-query";
import type { ContextCompleteness } from "./intelligence-query-context";
import type { IntelligenceEnvelope } from "./intelligence-envelope";
import type { IntelligenceDecisionContext, DecisionState } from "./intelligence-decision-context";
import type { FreshnessStatus, ProviderReliability } from "./provider-reliability";
import type { CrossProviderValidationStatus } from "./real-time-intelligence";
import type { PresenterFailureCategory } from "./ai-presenter-orchestration";
import type { ResponseIntegrityResult, ResponseIntegrityViolationKind } from "./ai-response-integrity";

export const INTELLIGENCE_AUDIT_TRACE_VERSION = "1.0.0";

/**
 * Sprint §2/§3 - market-data provenance and its honest fallback scope.
 * Reuses D2.6.3/D2.6.4/D2.6.5 fields verbatim (DataQualityAssessment,
 * ProviderReliability, CrossProviderValidationSummary) - no second
 * provider-health system is built here.
 *
 * HONEST SCOPE NOTE: `MarketDataService` does not currently return a
 * per-request ordered list of every provider attempted before the
 * winning one succeeded (that array is computed internally and only
 * used to build a single aggregate error on total failure - see
 * services/market-data/market-data.service.ts). Rather than fabricate a
 * plausible-looking ordered attempt list this program has no real data
 * for, `fallbackUsed` (a genuinely real, already-tracked boolean) is the
 * fallback-occurred signal, and `basis` states this scope boundary
 * explicitly whenever `fallbackUsed` is true. See the architecture
 * spec's "why the provider fallback trace is scoped this way" section.
 */
export interface AuditMarketDataProvenance {
  /** The real provider that ultimately served this data. */
  selectedProvider?: string;
  providerSymbol?: string;
  /** True only when a real failure from an earlier-priority provider preceded this success (D2.6.3's own provenance flag, never a guess). */
  fallbackUsed: boolean;
  cached: boolean;
  cacheAgeMs?: number;
  freshnessStatus?: FreshnessStatus;
  /** The real source timestamp of the underlying MarketSnapshot. */
  dataTimestamp?: string;
  /** The selected provider's real reliability state, when at least MIN_RELIABILITY_OBSERVATIONS real outcomes exist - undefined, never fabricated, otherwise. */
  reliability?: ProviderReliability;
  /** Present only when cross-provider validation was explicitly opted into for this request (D2.6.4/D2.6.5) - the real summary (never auto-resolved) already computed by summarizeConflicts(); the underlying per-field CrossProviderConflict[] is not duplicated here. */
  crossProviderValidation?: { status: CrossProviderValidationStatus; providers: string[]; basis: string[] };
  /** Deterministic, human-readable explanation - always includes the honest fallback-scope note when fallbackUsed is true. */
  basis: string[];
}

/**
 * Sprint §8 - AI response trace. One entry per presenter attempt exactly
 * as the D2.6.8 orchestrator recorded it (PresenterAttempt), plus an
 * optional, SAFE (never raw-error-text) list of integrity violation
 * KINDS when that attempt was rejected - the closed
 * ResponseIntegrityViolationKind vocabulary is diagnostic metadata, not
 * a secret or sensitive detail.
 */
export interface AuditPresenterAttemptTrace {
  provider: string;
  attempted: boolean;
  success: boolean;
  latencyMs?: number;
  failureCategory?: PresenterFailureCategory;
  integrityPassed?: boolean;
  integrityViolationKinds?: ResponseIntegrityViolationKind[];
  timestamp: string;
}

export interface AuditPresenterTrace {
  /** The provider whose text was actually returned to the trader - "deterministic-fallback" when every real provider was unavailable/failed/rejected. */
  selectedProvider: string;
  attempts: AuditPresenterAttemptTrace[];
  fallbackUsed: boolean;
  responseGeneratedAt: string;
}

/**
 * Sprint §9 - deterministic response-claim traceability. NOT another
 * LLM judging the first one - built entirely from
 * AIResponseIntegrityService's existing, unmodified extraction/matching
 * rules (see services/intelligence/audit/response-claim-tracer.service.ts).
 * Distinguishes "the model said something absent from the verified
 * context" (unsupported) from "the model said something that directly
 * contradicts the verified context" (conflicting) - the sprint's own
 * explicit required distinction.
 */
export type ClaimTraceCategory = "supported" | "unsupported" | "conflicting" | "unverifiable";

export interface ClaimTraceItem {
  category: ClaimTraceCategory;
  /** The exact substring of the response text this claim was extracted from. */
  claimText: string;
  /** Deterministic, human-readable reason for the classification - never a bare label. */
  basis: string;
}

export interface ResponseClaimTrace {
  claims: ClaimTraceItem[];
  supportedCount: number;
  unsupportedCount: number;
  conflictingCount: number;
  unverifiableCount: number;
  version: string;
}

/**
 * The canonical, immutable audit record for one presented trader answer.
 * Created only for a "resolved" real-time intelligence turn whose
 * envelope was actually handed to the AI Presenter Orchestrator (D2.6.8)
 * - a clarification-required/insufficient-data turn has no presented
 * answer to audit (see AuditTraceService's header for this scope
 * boundary). Once created, every field is permanent - see §13's
 * historical-immutability rule; a later re-analysis creates a NEW trace,
 * it never rewrites this one.
 */
export interface IntelligenceAuditTrace {
  traceId: string;
  /** Session-derived ownership identifier - never a secret, same convention as every other userId in this codebase. */
  userId: string;
  conversationId?: string;
  /** The real, persisted IntelligenceAnalysisRun this presented answer was derived from, when one was created for this turn. */
  analysisRunId?: string;

  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  queryType: IntelligenceQueryType;
  completeness: ContextCompleteness;
  /** IntelligenceDecisionContext.state at analysis time - never recomputed on read. */
  decisionState: DecisionState;

  /** The real IntelligenceEnvelope.generatedAt - "what the system knew THEN". */
  generatedAt: string;
  intelligenceEngineVersion: string;
  pipelineVersion: string;

  marketData: AuditMarketDataProvenance;

  /**
   * Full, immutable copies of the real envelope and decision context at
   * analysis time - this single pair already contains MarketState,
   * Regime, Hypotheses, EvidenceBundle, RiskProfile, HistoricalValidation,
   * and IntelligenceScore (via envelope) plus the trader-facing
   * DecisionContext view (§4's full required list). QueryContext is
   * deliberately NOT duplicated in full here - it is a relevance-
   * filtered SUBSET of these same two objects (D2.6.2's own framing);
   * its distinguishing fields (completeness, relevanceBasis,
   * missingContext) are captured directly on this trace instead of
   * duplicating the whole object, per the sprint's own "do not
   * duplicate large payloads unnecessarily" instruction.
   */
  envelope: IntelligenceEnvelope;
  decisionContext: IntelligenceDecisionContext;
  relevanceBasis: string[];
  missingContext: string[];

  presenter: AuditPresenterTrace;
  integrity: ResponseIntegrityResult;
  claimTrace: ResponseClaimTrace;

  responseGeneratedAt: string;
  /** When this immutable audit row was actually written - distinct from generatedAt/responseGeneratedAt, which describe the analysis itself. */
  createdAt: string;
  version: string;
}
