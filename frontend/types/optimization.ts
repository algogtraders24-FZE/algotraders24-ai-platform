// types/optimization.ts
// P4.9-A.2 - Algo Testing Pro's own registry-strategy parameter
// optimization (P4.9-R1/R2 locked contract, P4.9-A implementation design).
// A deliberately separate types module from types/algo-test.ts - a new,
// genuinely separate domain (locked file-split decision), not appended
// onto the existing Algo Test run types. Reuses concepts from that module
// (AlgoTestErrorCode's shape, AlgoTestParameterValues' "always complete,
// never partial" convention) without importing from it - this module's
// own OptimizationErrorCode is a deliberately separate union (see its own
// doc comment) so this addition never risks an exhaustive switch elsewhere
// over the unrelated AlgoTestErrorCode type.

/**
 * A deliberately separate union from algo-test.ts's own AlgoTestErrorCode -
 * not because the concepts differ (several values are the same literal
 * strings, reused on purpose), but because extending the existing shared
 * union would touch a type nothing in optimization.ts owns. Two values
 * genuinely new to this domain: INVALID_SEARCH_SPACE (a searchSpace entry
 * fails the parameter's own declared bounds, or omits the required `step`)
 * and TOO_MANY_CANDIDATES (the resolved grid exceeds the locked 256 cap).
 */
export type OptimizationErrorCode =
  | "INVALID_STRATEGY"
  | "INVALID_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_DATE_RANGE"
  | "RANGE_TOO_LARGE"
  | "INVALID_INITIAL_BALANCE"
  | "INVALID_SEARCH_SPACE"
  | "TOO_MANY_CANDIDATES"
  | "NO_HISTORICAL_DATA"
  | "PROVIDER_ERROR"
  | "NOT_FOUND"
  | "ALREADY_TERMINAL";

/** One swept parameter's requested grid, per the P4.9-R2 lock: `step` is REQUIRED here even though the registry's own StrategyParameterDefinition.step is optional (that optionality is about a single submitted value; admission into a search space is stricter). `min`/`max` are validated against the parameter's own declared bounds at creation time - never trusted verbatim. */
export interface OptimizationParameterRange {
  readonly parameterId: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface CreateOptimizationExperimentRequest {
  readonly strategyId: string;
  readonly symbol: string;
  /** Signal-facing string, e.g. "5m" - same convention as AlgoTestRunRequest.timeframe. */
  readonly timeframe: string;
  /** ISO 8601. */
  readonly startTime: string;
  /** ISO 8601. */
  readonly endTime: string;
  readonly initialBalance?: number;
  readonly searchSpace: readonly OptimizationParameterRange[];
}

export type OptimizationExperimentStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type OptimizationCandidateStatus = "UNRUN" | "RUNNING" | "COMPLETED" | "REJECTED" | "CANDIDATE" | "VALIDATED" | "FAILED";

/**
 * `profitFactor: Infinity` is a real, expected value (P4.9-R2's own
 * trade-count-characteristics audit) - `JSON.stringify(Infinity) === "null"`,
 * so it is never sent as a raw JSON number. `"Infinity"` (a string) on the
 * wire for that one case; a finite value is a normal JSON number; `null`
 * means "not yet computed" (the candidate hasn't reached a terminal status
 * with a result). Locked in P4.9-A's original design pass.
 */
export type OptimizationProfitFactor = number | "Infinity" | null;

/** Summary shape - returned by create/continue/cancel. No candidate list (see OptimizationExperimentDetailView for that). */
export interface OptimizationExperimentView {
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
  readonly totalCandidates: number;
  readonly processedCandidates: number;
  readonly status: OptimizationExperimentStatus;
  readonly bestCandidateId?: string | null;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface OptimizationCandidateView {
  /** The opaque DB id - what AlgoTestRun.experimentCandidateId would point to (v1 has no route that exposes that link yet - see A.2's own scope note). */
  readonly id: string;
  /** The deterministic identity - computeCanonicalHash({experimentId, parameterValues}). Same field name as the DB column (candidateHash), deliberately not renamed on the wire. */
  readonly candidateHash: string;
  readonly parameterValues: Readonly<Record<string, number | boolean | string>>;
  readonly status: OptimizationCandidateStatus;
  readonly tradeCount?: number | null;
  readonly profitFactor: OptimizationProfitFactor;
  readonly errorMessage?: string | null;
  readonly completedAt?: string;
}

/** Detail shape - adds the full candidate list and the two reproducibility fields, per getOptimizationExperiment(). */
export interface OptimizationExperimentDetailView extends OptimizationExperimentView {
  readonly searchSpace: readonly OptimizationParameterRange[];
  readonly strategyArtifactHash: string;
  readonly fingerprint: string;
  readonly candidates: readonly OptimizationCandidateView[];
}
