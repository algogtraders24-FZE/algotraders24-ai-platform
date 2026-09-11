// types/walk-forward.ts
// P4.9-B-B.2 (docs/P4.9-OPTIMIZATION-WFO.md's own locked P4.9-B-R1/R2
// contract) - Walk-Forward Optimization's own wire/service-layer shapes.
// Deliberately a SEPARATE module from types/optimization.ts - the exact
// same "deliberately separate, even where several values are the same
// literal strings, so an exhaustive switch elsewhere never risks
// including a foreign value" reasoning that module's own doc comment
// already establishes for its own split from types/algo-test.ts. WFO is
// a genuinely separate domain built ON the same primitives P4.9-A
// already proved out, not an extension of OptimizationExperiment's own
// shape - the locked "no global winner" architecture alone makes the two
// fundamentally different, not just differently named.
import type { OptimizationProfitFactor } from "./optimization";

/**
 * A deliberately separate union from OptimizationErrorCode - several
 * values are the same literal strings, reused on purpose (the same
 * request-validation surface: strategy/symbol/timeframe/date-range/
 * initial-balance/search-space checks are identical between the two
 * domains). Values genuinely new here: INSUFFICIENT_SPAN_FOR_FOLDS
 * (P4.9-B-R2 locked - totalSpanDays < inSampleDays + outOfSampleDays),
 * INVALID_PARENT/INVALID_TRANSITION/DUPLICATE_CANDIDATE_HASH/
 * ALREADY_TERMINAL (the lifecycle-integrity codes B.2 itself owns -
 * OptimizationErrorCode never needed them because A's own service never
 * accepted externally-supplied candidate identity or exposed standalone
 * fold/candidate lifecycle operations the way B.2 must). PROVIDER_ERROR
 * (P4.9-B-B.3 addition) mirrors OptimizationErrorCode's own value
 * verbatim - the identical "transient fetch failure, pause and let the
 * client retry" signal continueOptimizationExperiment() already
 * establishes, now needed by walk-forward-execution.service.ts's own
 * continueWalkForwardExperiment() for the exact same reason.
 */
export type WalkForwardErrorCode =
  | "INVALID_STRATEGY"
  | "INVALID_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_DATE_RANGE"
  | "RANGE_TOO_LARGE"
  | "INVALID_INITIAL_BALANCE"
  | "INVALID_SEARCH_SPACE"
  | "INSUFFICIENT_SPAN_FOR_FOLDS"
  | "PROVIDER_ERROR"
  | "NOT_FOUND"
  | "INVALID_PARENT"
  | "INVALID_TRANSITION"
  | "DUPLICATE_CANDIDATE_HASH"
  | "ALREADY_TERMINAL";

/** Same vocabulary as OptimizationExperimentStatus (types/optimization.ts) - P4.9-B-R2 locked reuse, not a coincidence. */
export type WalkForwardExperimentStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

/**
 * A fold is a TWO-PHASE unit of work (optimize its own in-sample
 * candidates, then validate that fold's own winner out-of-sample exactly
 * once) - not a candidate itself, so this is its own vocabulary, never
 * OptimizationCandidateStatus/WalkForwardCandidateStatus reused by
 * mistake.
 */
export type WalkForwardFoldStatus = "UNRUN" | "OPTIMIZING" | "VALIDATING" | "COMPLETED" | "FAILED";

/**
 * Deliberately the SAME literal vocabulary as OptimizationCandidateStatus
 * - a fold's own in-sample sweep is the exact same mechanism P4.9-A
 * already built (claim/execute/finalize), reused verbatim per fold - but
 * a genuinely separate type, matching this whole module's own
 * "deliberately separate" convention.
 */
export type WalkForwardCandidateStatus = "UNRUN" | "RUNNING" | "COMPLETED" | "REJECTED" | "CANDIDATE" | "VALIDATED" | "FAILED";

/** P4.9-B-R2 locked - the process-level verdict, and the per-fold OOS outcome. Deliberately the same three-valued shape (never binary) - see the locked contract's own PASSED/FAILED/INCONCLUSIVE table. */
export type WalkForwardVerdict = "PASSED" | "FAILED" | "INCONCLUSIVE";
export type WalkForwardOosOutcome = "PASSED" | "FAILED" | "INCONCLUSIVE";

/** Identical shape to OptimizationParameterRange (types/optimization.ts) - the swept-parameter contract is unchanged, WFO just applies it independently per fold (P4.9-B-R2 locked: searchSpace lives at the EXPERIMENT level, shared across every fold). */
export interface WalkForwardParameterRange {
  readonly parameterId: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface CreateWalkForwardExperimentRequest {
  readonly strategyId: string;
  readonly symbol: string;
  /** Signal-facing string, e.g. "5m" - same convention as CreateOptimizationExperimentRequest.timeframe. */
  readonly timeframe: string;
  /** ISO 8601. */
  readonly startTime: string;
  /** ISO 8601. */
  readonly endTime: string;
  readonly initialBalance?: number;
  readonly searchSpace: readonly WalkForwardParameterRange[];
  // Deliberately NO inSampleDays/outOfSampleDays/stepDays here - P4.9-B-R2
  // locked these as server-side constants (WALK_FORWARD_IN_SAMPLE_DAYS/
  // OUT_OF_SAMPLE_DAYS/STEP_DAYS in walk-forward.service.ts), never
  // client-configurable, the exact same convention
  // minEligibleTrades/candidateCap already establish for
  // CreateOptimizationExperimentRequest.
}

/** Summary shape - returned by create/cancel/transition operations. No fold/candidate list (see WalkForwardExperimentDetailView for that). */
export interface WalkForwardExperimentView {
  readonly experimentId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly initialBalance: number;
  readonly objective: string;
  readonly minEligibleTrades: number;
  readonly candidateCap: number;
  readonly inSampleDays: number;
  readonly outOfSampleDays: number;
  readonly stepDays: number;
  readonly totalFolds: number;
  readonly foldsCompleted: number;
  readonly status: WalkForwardExperimentStatus;
  readonly validationMethod: "walk-forward";
  readonly verdict?: WalkForwardVerdict | null;
  readonly passedFoldCount: number;
  readonly conclusiveFoldCount: number;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface WalkForwardCandidateView {
  readonly id: string;
  readonly foldId: string;
  readonly candidateHash: string;
  readonly parameterValues: Readonly<Record<string, number | boolean | string>>;
  readonly status: WalkForwardCandidateStatus;
  readonly tradeCount?: number | null;
  readonly profitFactor: OptimizationProfitFactor;
  readonly errorMessage?: string | null;
  readonly completedAt?: string;
}

export interface WalkForwardFoldView {
  readonly id: string;
  readonly experimentId: string;
  readonly foldIndex: number;
  readonly inSampleStart: string;
  readonly inSampleEnd: string;
  readonly outOfSampleStart: string;
  readonly outOfSampleEnd: string;
  readonly status: WalkForwardFoldStatus;
  readonly winnerCandidateId?: string | null;
  readonly oosProfitFactor: OptimizationProfitFactor;
  readonly oosTradeCount?: number | null;
  readonly oosOutcome?: WalkForwardOosOutcome | null;
  readonly errorMessage?: string | null;
  readonly completedAt?: string;
}

export interface WalkForwardFoldDetailView extends WalkForwardFoldView {
  readonly candidates: readonly WalkForwardCandidateView[];
}

/** Detail shape - adds the full fold list (each with its own candidates) and the two reproducibility fields, per getWalkForwardExperiment(). */
export interface WalkForwardExperimentDetailView extends WalkForwardExperimentView {
  readonly searchSpace: readonly WalkForwardParameterRange[];
  readonly strategyArtifactHash: string;
  readonly fingerprint: string;
  readonly folds: readonly WalkForwardFoldDetailView[];
}
