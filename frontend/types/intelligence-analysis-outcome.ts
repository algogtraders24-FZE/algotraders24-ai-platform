// types/intelligence-analysis-outcome.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation. Records what
// was later found to actually happen for an IntelligenceAnalysisRun.
//
// `validated`/`invalidated` are defined here for forward compatibility but
// are structurally unreachable in D2.5.1's evaluator: with no Hypothesis
// Engine yet, there is never a falsifiable directional claim to check a
// real outcome against. See services/intelligence/memory/
// outcome-evaluator.service.ts for the conservative logic this sprint
// actually implements (real price-move calculation when possible, always
// "inconclusive" or "pending" as the resulting status - never a fabricated
// validated/invalidated verdict).
export type IntelligenceAnalysisOutcomeStatus = "pending" | "validated" | "invalidated" | "inconclusive";

export interface IntelligenceAnalysisOutcome {
  id: string;
  analysisRunId: string;
  /** Always null in D2.5.1 - no Hypothesis Engine exists yet. */
  hypothesisId: string | null;
  /** Null while status is "pending" - evaluation hasn't produced a real result yet. */
  evaluatedAt: string | null;
  status: IntelligenceAnalysisOutcomeStatus;
  /** Real, computed only when a price-type evidence item at analysis time AND a real current snapshot are both available. Never estimated. */
  actualPriceMovePct: number | null;
  /** Always null in D2.5.1 - no Regime Engine exists yet. */
  actualRegimeAfter: unknown | null;
  /** Required: always states exactly why this status was assigned - never a bare status with no explanation. */
  evaluationBasis: string;
  createdAt: string;
}
