// types/intelligence-query-context.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration.
// IntelligenceQueryContext is the final, VERIFIED, RELEVANCE-FILTERED
// object safe to hand to a future AIIntelligencePresenter (D2.5.5). It
// is built by services/intelligence/query/intelligence-query-context.
// service.ts from an existing IntelligenceEnvelope/IntelligenceDecisionContext
// - never from a fresh computation, never from an LLM.
//
// This is deliberately a SUBSET of a full IntelligenceDecisionContext,
// not a duplicate of it: `selectedEvidence`/`selectedHypotheses`/
// `selectedConflicts` are the relevant slice for THIS query, not "all
// evidence that happens to exist" - see the spec's relevance-filtering
// rules. `decisionContext` itself is still attached in full when
// `scopes` includes "decision-context", for a presenter that wants the
// complete picture.
import type { EvidenceItem, EvidenceConflict } from "./evidence";
import type { Hypothesis } from "./intelligence-hypothesis";
import type { IntelligenceScore } from "./intelligence-score";
import type { IntelligenceDecisionContext, DecisionHistoricalContext, DecisionRiskContext } from "./intelligence-decision-context";
import type { IntelligenceAnalysisRun } from "./intelligence-analysis-run";
import type { IntelligenceAnalysisOutcome } from "./intelligence-analysis-outcome";
import type { IntelligenceQuery } from "./intelligence-query";

/**
 * NOT another Intelligence Score (sprint §17 is explicit: "This is NOT
 * another Intelligence Score. Do not create another numeric score.").
 * Describes whether enough real data existed to answer the query's
 * requested scopes, never how "good" the underlying market situation is.
 */
export type ContextCompleteness = "complete" | "partial" | "insufficient";

/** Example C's flow: a specific prior analysis, its real outcome(s), and the historical validation it fed - never a rewritten summary. */
export interface PreviousAnalysisContext {
  analysisRun: IntelligenceAnalysisRun;
  outcomes: IntelligenceAnalysisOutcome[];
}

export interface IntelligenceQueryContext {
  query: IntelligenceQuery;

  /** Attached only when "decision-context" was a requested scope, or as the source object selection was drawn from - see the orchestrator. */
  decisionContext?: IntelligenceDecisionContext;

  /** Relevance-filtered, deterministically ranked (EvidenceRankingService, 15D.4) - never the full unfiltered evidence set. */
  selectedEvidence: EvidenceItem[];
  /** Relevance-filtered by symbol/timeframe/regime/scope - never a newly-generated hypothesis. */
  selectedHypotheses: Hypothesis[];
  selectedConflicts: EvidenceConflict[];

  historicalContext?: DecisionHistoricalContext;
  riskContext?: DecisionRiskContext;
  intelligenceScore?: IntelligenceScore;

  /** Populated only when a real, authorized prior IntelligenceAnalysisRun was requested and found - never fabricated, never another user's data. */
  previousAnalysis?: PreviousAnalysisContext;

  completeness: ContextCompleteness;
  /** Auditable trail of why each selected item was included, e.g. "Same symbol as query", "Directly linked to selected hypothesis" - never silent selection. */
  relevanceBasis: string[];
  /** Every requested scope this context could NOT satisfy, plus why - a scope simply absent from this array was genuinely satisfiable, not silently dropped. */
  missingContext: string[];

  /** The real timestamp the underlying MarketState/envelope was generated at - never fabricated, absent when no envelope was available. */
  dataAsOf?: string;
  generatedAt: string;
  pipelineVersion: string;
  /** Independent of intelligenceEngineVersion - bumps only when this orchestration layer's own selection/completeness rules change. */
  orchestrationVersion: string;
}
