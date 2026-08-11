// types/intelligence-explanation.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. A structured, deterministic "why am I seeing this?"
// record - every field is a direct relabeling/regrouping of an already-
// real, already-computed IntelligenceDecisionContext (D2.6.1) field plus
// the real market-data provenance (D2.6.9's own AuditMarketDataProvenance).
// No new computation, no new score, no new claim - see
// services/intelligence/audit/explanation.service.ts's pure builder.
//
// The LLM presentation layer may restate this object in prose; it can
// never modify its factual content - identical to the AIPresentationResult
// boundary D2.5.5 established for the envelope itself.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type {
  DecisionCurrentState,
  DecisionRegimeContext,
  DecisionHypothesisContext,
  DecisionInvalidationItem,
  DecisionRiskContext,
  DecisionHistoricalContext,
  DecisionMissingInformationItem,
  DecisionState,
} from "./intelligence-decision-context";
import type { EvidenceItem, EvidenceConflict } from "./evidence";
import type { IntelligenceScore } from "./intelligence-score";
import type { AuditMarketDataProvenance } from "./intelligence-audit-trace";

export const INTELLIGENCE_EXPLANATION_VERSION = "1.0.0";

/** "What happened?" - current state + regime, direct passthrough. */
export interface ExplanationCurrentState {
  currentState: DecisionCurrentState;
  regime: DecisionRegimeContext;
}

/** "Why?" - supporting evidence, direct passthrough. */
export interface ExplanationSupport {
  supportingEvidence: EvidenceItem[];
}

/** "What disagrees?" - opposing evidence and unresolved conflicts, direct passthrough. */
export interface ExplanationDisagreement {
  opposingEvidence: EvidenceItem[];
  unresolvedConflicts: EvidenceConflict[];
}

/** "What could happen?" - the active hypothesis/hypotheses, direct passthrough. May legitimately be empty. */
export interface ExplanationPossibility {
  hypotheses: DecisionHypothesisContext[];
}

/** "What would invalidate it?" - the stored invalidation condition(s), direct passthrough. */
export interface ExplanationInvalidation {
  conditions: DecisionInvalidationItem[];
}

/** "How strong is the intelligence?" - the existing Intelligence Score and decision state, never recalculated here. */
export interface ExplanationStrength {
  intelligenceScore: IntelligenceScore;
  decisionState: DecisionState;
}

/** "Has it worked historically?" - the existing historical validation segment, direct passthrough. */
export interface ExplanationHistory {
  historicalContext: DecisionHistoricalContext;
}

/** "What is missing?" - the existing missing-information list, direct passthrough. */
export interface ExplanationGaps {
  items: DecisionMissingInformationItem[];
}

/** "What data was used?" - real provider/freshness/provenance, never recomputed. */
export interface ExplanationDataUsed {
  marketData: AuditMarketDataProvenance;
}

/** Risk is included for completeness even though the sprint's own worked example doesn't list it separately - it is real DecisionContext output, never omitted silently. */
export interface ExplanationRisk {
  riskContext: DecisionRiskContext;
}

export interface IntelligenceExplanation {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;

  whatHappened: ExplanationCurrentState;
  why: ExplanationSupport;
  whatDisagrees: ExplanationDisagreement;
  whatCouldHappen: ExplanationPossibility;
  whatWouldInvalidate: ExplanationInvalidation;
  howStrong: ExplanationStrength;
  risk: ExplanationRisk;
  historicalPerformance: ExplanationHistory;
  whatIsMissing: ExplanationGaps;
  whatDataWasUsed: ExplanationDataUsed;

  /** The real envelope/decision-context generatedAt this explanation describes - never a fresh "now". */
  generatedAt: string;
  version: string;
}
