// types/intelligence-analysis-outcome.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation. Records what
// was later found to actually happen for an IntelligenceAnalysisRun.
//
// `validated`/`invalidated` are defined here for forward compatibility but
// are structurally unreachable in D2.5.1's evaluator: with no Hypothesis
// Engine yet, there is never a falsifiable directional claim to check a
// real outcome against. See services/intelligence/memory/
// outcome-evaluator.service.ts for the conservative logic that evaluator
// still implements unchanged (real price-move calculation when possible,
// always "inconclusive" or "pending" - never a fabricated verdict).
//
// Sprint D2.5.4 - validated/invalidated ARE reachable now, but only via
// the new, separate services/intelligence/hypothesis/hypothesis-outcome-
// evaluator.service.ts (D2.5.1's own evaluator above is untouched and
// still only ever produces pending/inconclusive). Added `hypothesisType`/
// `regimeType` (additive; every existing field is untouched) - denormalized
// from the real evaluated Hypothesis/Regime purely for efficient
// historical-validation segmentation, never a second, independently-set
// source of truth.
export type IntelligenceAnalysisOutcomeStatus = "pending" | "validated" | "invalidated" | "inconclusive";

export interface IntelligenceAnalysisOutcome {
  id: string;
  analysisRunId: string;
  /** Real (matches a Hypothesis.id) as of D2.5.4, when a real hypothesis was evaluated. Still null for D2.5.1's original evaluator's outcomes. */
  hypothesisId: string | null;
  /** Sprint D2.5.4 - copied from the evaluated Hypothesis.type at evaluation time. Null when no real hypothesis was evaluated. */
  hypothesisType: string | null;
  /** Sprint D2.5.4 - copied from the evaluated Hypothesis.regimeContext.regimeType at evaluation time. Null when no real hypothesis was evaluated. */
  regimeType: string | null;
  /** Null while status is "pending" - evaluation hasn't produced a real result yet. */
  evaluatedAt: string | null;
  status: IntelligenceAnalysisOutcomeStatus;
  /** Real, computed only when a price-type evidence item at analysis time AND a real current snapshot are both available. Never estimated. */
  actualPriceMovePct: number | null;
  /** Always null in D2.5.1 - no Regime Engine exists yet. */
  actualRegimeAfter: unknown | null;
  /** Required: always states exactly why this status was assigned - never a bare status with no explanation. As of D2.5.4, a JSON-serialized HypothesisEvaluationBasis for hypothesis-evaluated outcomes. */
  evaluationBasis: string;
  createdAt: string;
}
