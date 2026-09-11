// services/algo-test/walk-forward.service.ts
// P4.9-B-B.2 (docs/P4.9-OPTIMIZATION-WFO.md's own locked P4.9-B-R1/R2
// contract) - the lifecycle/service foundation for the already-persisted
// WalkForwardExperiment -> WalkForwardFold -> WalkForwardCandidate model
// (P4.9-B-B.1). This is PERSISTENCE + LIFECYCLE only - it makes the model
// usable by a future execution layer (P4.9-B-B.3), it does NOT implement
// walk-forward optimization itself. Concretely, this file never: expands
// a searchSpace into concrete candidates, calls runSimulation(), fetches
// market data, computes an OOS outcome/verdict, or selects a winner - it
// only PERSISTS whatever a future caller (B.3) has already decided,
// exactly the same "B.2 persists what B.3 decides" boundary applied
// consistently to every entity below.
//
// Reuses every P4.9-A primitive it can rather than duplicating logic:
// getStrategyDefinition/SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME/
// maxRangeDaysFor/DEFAULT_INITIAL_BALANCE (algo-test.service.ts),
// OPTIMIZATION_CANDIDATE_CAP/OPTIMIZATION_MIN_ELIGIBLE_TRADES
// (optimization.service.ts - "candidateCap: 256 (unchanged)",
// "minEligibleTrades: 20 (unchanged)" per the locked R2 table),
// computeCanonicalHash (at24-quant-engine). The one genuinely new piece
// of logic is deriveFolds() - the locked R2 fold-derivation formula,
// pure date math, zero simulation/optimization/market-data involved.
import { computeCanonicalHash, RUNTIME_VERSION, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency, type Timeframe } from "at24-quant-engine";
import { prisma } from "@/lib/prisma";
import { getStrategyDefinition, type StrategyDefinition } from "./strategy-registry";
import { DEFAULT_INITIAL_BALANCE, maxRangeDaysFor, SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME } from "./algo-test.service";
import { OPTIMIZATION_CANDIDATE_CAP, OPTIMIZATION_MIN_ELIGIBLE_TRADES } from "./optimization.service";
import type {
  CreateWalkForwardExperimentRequest,
  WalkForwardCandidateStatus,
  WalkForwardCandidateView,
  WalkForwardErrorCode,
  WalkForwardExperimentDetailView,
  WalkForwardExperimentStatus,
  WalkForwardExperimentView,
  WalkForwardFoldDetailView,
  WalkForwardFoldStatus,
  WalkForwardFoldView,
  WalkForwardOosOutcome,
  WalkForwardParameterRange,
  WalkForwardVerdict,
} from "@/types/walk-forward";
import type { OptimizationProfitFactor } from "@/types/optimization";

// ---------------------------------------------------------------------------
// P4.9-B-R2 locked constants - never accepted from the client, always
// applied server-side (the exact "locked, never user-configurable"
// convention OPTIMIZATION_CANDIDATE_CAP/OPTIMIZATION_MIN_ELIGIBLE_TRADES
// already establish). Measured, not guessed - the R2 Measurement Gate's
// own disposable script found every fixed config tested is regime-
// dependent, not "solved" by these numbers; 7/3/3 is the least-bad
// measured v1 choice, explicitly not claimed optimal (see the doc).
// ---------------------------------------------------------------------------
export const WALK_FORWARD_IN_SAMPLE_DAYS = 7;
export const WALK_FORWARD_OUT_OF_SAMPLE_DAYS = 3;
export const WALK_FORWARD_STEP_DAYS = 3;

const DAY_MS = 86_400_000;

/**
 * A small, LOCAL per-timeframe bar-interval lookup (same one-entry-today
 * style as algo-test.service.ts's own SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME)
 * - deliberately NOT importing/exporting a new symbol from
 * algo-test.service.ts's own module-private BARS_PER_DAY table. The fold
 * boundary math below needs only milliseconds-per-bar, a smaller, more
 * targeted fact than BARS_PER_DAY's fuller max-range-days concept, and
 * this tier's own scope discipline favors a small local table over
 * touching an existing P4.9-A file for it.
 */
const BAR_INTERVAL_MS: Partial<Readonly<Record<Timeframe, number>>> = {
  M5: 5 * 60_000,
};

function barIntervalMsFor(engineTimeframe: Timeframe): number {
  const ms = BAR_INTERVAL_MS[engineTimeframe];
  if (ms === undefined) {
    throw new Error(`barIntervalMsFor: no bar-interval data for Timeframe "${engineTimeframe}" - walk-forward has no fold-boundary math for it yet.`);
  }
  return ms;
}

export class WalkForwardServiceError extends Error {
  constructor(
    readonly code: WalkForwardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WalkForwardServiceError";
  }
}

// ---------------------------------------------------------------------------
// Fold derivation (P4.9-B-R2 locked formula, transcribed verbatim)
// ---------------------------------------------------------------------------

export interface DerivedFoldWindow {
  readonly foldIndex: number;
  readonly inSampleStart: Date;
  readonly inSampleEnd: Date;
  readonly outOfSampleStart: Date;
  readonly outOfSampleEnd: Date;
}

/**
 * P4.9-B-R2 locked fold-derivation formula - pure date math, zero
 * simulation/optimization/market-data involved. Exported standalone (the
 * same "computeTotalCandidates() as its own testable function" precedent
 * optimization.service.ts already establishes) so a future B.3 and this
 * tier's own tests can call/verify it in isolation. Returns an empty
 * array when the span cannot fit even one fold - the caller turns that
 * into the locked INSUFFICIENT_SPAN_FOR_FOLDS error, never a silent
 * zero-fold experiment.
 *
 * Locked boundary correction (measured, not assumed - the R2 Measurement
 * Gate proved a naive shared boundary double-counts a real bar):
 * outOfSampleStart is ALWAYS inSampleEnd + one bar interval, never a
 * shared instant.
 */
export function deriveFolds(startTime: Date, endTime: Date, engineTimeframe: Timeframe): readonly DerivedFoldWindow[] {
  const totalSpanDays = (endTime.getTime() - startTime.getTime()) / DAY_MS;
  if (totalSpanDays < WALK_FORWARD_IN_SAMPLE_DAYS + WALK_FORWARD_OUT_OF_SAMPLE_DAYS) return [];

  const barIntervalMs = barIntervalMsFor(engineTimeframe);
  const totalFolds = Math.floor((totalSpanDays - WALK_FORWARD_IN_SAMPLE_DAYS - WALK_FORWARD_OUT_OF_SAMPLE_DAYS) / WALK_FORWARD_STEP_DAYS) + 1;

  const folds: DerivedFoldWindow[] = [];
  for (let i = 0; i < totalFolds; i++) {
    const inSampleStart = new Date(startTime.getTime() + i * WALK_FORWARD_STEP_DAYS * DAY_MS);
    const inSampleEnd = new Date(inSampleStart.getTime() + WALK_FORWARD_IN_SAMPLE_DAYS * DAY_MS);
    const outOfSampleStart = new Date(inSampleEnd.getTime() + barIntervalMs);
    const outOfSampleEnd = new Date(outOfSampleStart.getTime() + WALK_FORWARD_OUT_OF_SAMPLE_DAYS * DAY_MS);
    folds.push({ foldIndex: i, inSampleStart, inSampleEnd, outOfSampleStart, outOfSampleEnd });
  }
  return folds;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ValidatedWalkForwardRequest {
  readonly strategy: StrategyDefinition;
  readonly engineTimeframe: Timeframe;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialBalance: number;
  readonly searchSpace: readonly WalkForwardParameterRange[];
  readonly folds: readonly DerivedFoldWindow[];
}

/**
 * Mirrors optimization.service.ts's own validateCreateRequest() ordering
 * and reuses every real primitive it can (getStrategyDefinition,
 * SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, maxRangeDaysFor,
 * DEFAULT_INITIAL_BALANCE) - the exact same "duplicate a handful of
 * orchestration lines, reuse every actual check" choice that file's own
 * doc comment already defends, extended to this sibling domain. Two
 * checks genuinely new here: the P4.9-B-R2 locked INSUFFICIENT_SPAN_FOR_FOLDS
 * guard (deriveFolds() returning zero folds), and reusing
 * maxRangeDaysFor's SAME per-request provider cap for the whole WFO span
 * (the locked "bounded total span" decision - no new fetch architecture).
 */
function validateCreateRequest(request: CreateWalkForwardExperimentRequest): { readonly code: WalkForwardErrorCode; readonly message: string } | ValidatedWalkForwardRequest {
  const strategy = getStrategyDefinition(request.strategyId);
  if (!strategy || strategy.status !== "available") {
    return { code: "INVALID_STRATEGY", message: `Unsupported strategy '${request.strategyId}'.` };
  }
  if (!strategy.supportedSymbols.includes(request.symbol)) {
    return { code: "INVALID_SYMBOL", message: `Unsupported symbol '${request.symbol}' for strategy '${strategy.strategyId}'. Supported: ${strategy.supportedSymbols.join(", ")}.` };
  }
  if (!strategy.supportedTimeframes.includes(request.timeframe)) {
    return { code: "INVALID_TIMEFRAME", message: `Unsupported timeframe '${request.timeframe}' for strategy '${strategy.strategyId}'. Supported: ${strategy.supportedTimeframes.join(", ")}.` };
  }
  const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[request.timeframe];
  if (!engineTimeframe) {
    return { code: "INVALID_TIMEFRAME", message: `Timeframe '${request.timeframe}' has no engine mapping.` };
  }

  const startTime = new Date(request.startTime);
  const endTime = new Date(request.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { code: "INVALID_DATE_RANGE", message: "startTime/endTime could not be parsed as dates." };
  }
  if (startTime.getTime() >= endTime.getTime()) {
    return { code: "INVALID_DATE_RANGE", message: "startTime must be before endTime." };
  }
  if (endTime.getTime() > Date.now()) {
    return { code: "INVALID_DATE_RANGE", message: "endTime cannot be in the future - this is a historical sweep, not a live/forward test." };
  }
  const rangeDays = (endTime.getTime() - startTime.getTime()) / DAY_MS;
  const maxRangeDays = maxRangeDaysFor(engineTimeframe);
  if (rangeDays > maxRangeDays) {
    // P4.9-B-R2 locked - the total WFO span is bounded to the SAME
    // per-request provider cap ordinary optimization already respects,
    // not a new, larger ceiling. No new fetch architecture is needed
    // because of this.
    return { code: "RANGE_TOO_LARGE", message: `Date range spans ${rangeDays.toFixed(1)} days; the maximum supported total walk-forward span for ${engineTimeframe} is ${maxRangeDays} days.` };
  }

  const initialBalance = request.initialBalance ?? DEFAULT_INITIAL_BALANCE;
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    return { code: "INVALID_INITIAL_BALANCE", message: "initialBalance must be a finite, positive number." };
  }

  const declaredById = new Map(strategy.parameters.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const range of request.searchSpace) {
    if (seen.has(range.parameterId)) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}' appears more than once in searchSpace.` };
    }
    seen.add(range.parameterId);

    const param = declaredById.get(range.parameterId);
    if (!param) {
      return { code: "INVALID_SEARCH_SPACE", message: `Unknown parameter '${range.parameterId}' - not declared for strategy '${strategy.strategyId}'.` };
    }
    if (param.type !== "number" && param.type !== "integer") {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}' is not a numeric parameter - only number/integer parameters can be swept.` };
    }
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || !Number.isFinite(range.step) || range.step <= 0) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min/max/step must be finite numbers and step must be > 0.` };
    }
    if (range.min > range.max) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min (${range.min}) must be <= max (${range.max}).` };
    }
    if (param.min !== undefined && range.min < param.min) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min (${range.min}) is below the parameter's own declared minimum (${param.min}).` };
    }
    if (param.max !== undefined && range.max > param.max) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': max (${range.max}) is above the parameter's own declared maximum (${param.max}).` };
    }
  }

  const folds = deriveFolds(startTime, endTime, engineTimeframe);
  if (folds.length === 0) {
    return { code: "INSUFFICIENT_SPAN_FOR_FOLDS", message: `Date range spans ${rangeDays.toFixed(1)} days, too short for even one ${WALK_FORWARD_IN_SAMPLE_DAYS}-day in-sample + ${WALK_FORWARD_OUT_OF_SAMPLE_DAYS}-day out-of-sample fold.` };
  }

  return { strategy, engineTimeframe, startTime, endTime, initialBalance, searchSpace: request.searchSpace, folds };
}

// ---------------------------------------------------------------------------
// View projections
// ---------------------------------------------------------------------------

type WalkForwardExperimentRow = Awaited<ReturnType<typeof prisma.walkForwardExperiment.findFirstOrThrow>>;
type WalkForwardFoldRow = Awaited<ReturnType<typeof prisma.walkForwardFold.findFirstOrThrow>>;
type WalkForwardCandidateRow = Awaited<ReturnType<typeof prisma.walkForwardCandidate.findFirstOrThrow>>;

/** Same `number | "Infinity" | null` wire convention as optimization.service.ts's own serializeProfitFactor() - reused verbatim, not reimplemented. */
function serializeProfitFactor(value: number | null | undefined): OptimizationProfitFactor {
  if (value === null || value === undefined) return null;
  return value === Number.POSITIVE_INFINITY ? "Infinity" : value;
}

function toExperimentView(row: WalkForwardExperimentRow): WalkForwardExperimentView {
  return {
    experimentId: row.id,
    strategyId: row.strategyId,
    symbol: row.symbol,
    timeframe: row.timeframe,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    initialBalance: row.initialBalance,
    objective: row.objective,
    minEligibleTrades: row.minEligibleTrades,
    candidateCap: row.candidateCap,
    inSampleDays: row.inSampleDays,
    outOfSampleDays: row.outOfSampleDays,
    stepDays: row.stepDays,
    totalFolds: row.totalFolds,
    foldsCompleted: row.foldsCompleted,
    status: row.status as WalkForwardExperimentStatus,
    validationMethod: row.validationMethod as "walk-forward",
    verdict: row.verdict as WalkForwardVerdict | null,
    passedFoldCount: row.passedFoldCount,
    conclusiveFoldCount: row.conclusiveFoldCount,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
  };
}

function toFoldView(row: WalkForwardFoldRow): WalkForwardFoldView {
  return {
    id: row.id,
    experimentId: row.experimentId,
    foldIndex: row.foldIndex,
    inSampleStart: row.inSampleStart.toISOString(),
    inSampleEnd: row.inSampleEnd.toISOString(),
    outOfSampleStart: row.outOfSampleStart.toISOString(),
    outOfSampleEnd: row.outOfSampleEnd.toISOString(),
    status: row.status as WalkForwardFoldStatus,
    winnerCandidateId: row.winnerCandidateId,
    oosProfitFactor: serializeProfitFactor(row.oosProfitFactor),
    oosTradeCount: row.oosTradeCount,
    oosOutcome: row.oosOutcome as WalkForwardOosOutcome | null,
    errorMessage: row.errorMessage,
    completedAt: row.completedAt?.toISOString(),
  };
}

function toCandidateView(row: WalkForwardCandidateRow): WalkForwardCandidateView {
  return {
    id: row.id,
    foldId: row.foldId,
    candidateHash: row.candidateHash,
    parameterValues: row.parameterValues as unknown as Record<string, number | boolean | string>,
    status: row.status as WalkForwardCandidateStatus,
    tradeCount: row.tradeCount,
    profitFactor: serializeProfitFactor(row.profitFactor),
    errorMessage: row.errorMessage,
    completedAt: row.completedAt?.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal transition helper - one shared, atomic conditional-transition
// primitive, reused by every entity's own transition function below,
// rather than eight near-identical hand-rolled updateMany() calls. Same
// "count===1 or it didn't happen" invariant optimization.service.ts's own
// claimNextCandidate()/finalizeIfComplete() already establish.
// ---------------------------------------------------------------------------

async function atomicStatusTransition(
  model: { updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }> },
  id: string,
  fromStatuses: readonly string[],
  data: Record<string, unknown>,
  onRejected: () => never,
): Promise<void> {
  const result = await model.updateMany({ where: { id, status: { in: fromStatuses } }, data });
  if (result.count !== 1) onRejected();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const walkForwardService = {
  /**
   * Creates the experiment AND every one of its folds (derived once, via
   * the locked formula, from experiment-level config alone - pure date
   * math, not "generating optimization candidates") in one transaction.
   * Deliberately does NOT create any WalkForwardCandidate rows - that
   * requires expanding searchSpace into concrete parameter combinations
   * per fold, which IS candidate generation in the excluded, algorithmic
   * sense (P4.9-B-B.3's own job). There is also deliberately no separate
   * public "create fold" operation: the locked contract fully determines
   * every fold's boundaries from inSampleDays/outOfSampleDays/stepDays at
   * creation time, folds are never independently created later.
   */
  async createWalkForwardExperiment(userId: string, request: CreateWalkForwardExperimentRequest): Promise<WalkForwardExperimentView> {
    const validated = validateCreateRequest(request);
    if (!("strategy" in validated)) {
      throw new WalkForwardServiceError(validated.code, validated.message);
    }
    const { strategy, startTime, endTime, initialBalance, searchSpace, folds } = validated;

    const strategyArtifactHash = strategy.reproducibility.baseContentHash;
    const objective = "profitFactor";
    const minEligibleTrades = OPTIMIZATION_MIN_ELIGIBLE_TRADES;
    const candidateCap = OPTIMIZATION_CANDIDATE_CAP;

    // Same two-fingerprint reproducibility split as optimization.service.ts
    // (strategyArtifactHash stays its own column - "what was optimized" -
    // fingerprint answers "under exactly what conditions", now
    // incorporating the locked fold configuration as one of its own
    // inputs too).
    const fingerprint = computeCanonicalHash({
      strategyId: strategy.strategyId,
      strategyArtifactHash,
      searchSpace,
      objective,
      minEligibleTrades,
      candidateCap,
      inSampleDays: WALK_FORWARD_IN_SAMPLE_DAYS,
      outOfSampleDays: WALK_FORWARD_OUT_OF_SAMPLE_DAYS,
      stepDays: WALK_FORWARD_STEP_DAYS,
      symbol: request.symbol,
      timeframe: request.timeframe,
      startTime: request.startTime,
      endTime: request.endTime,
      initialBalance,
      validationMethod: "walk-forward",
      engineVersion: RUNTIME_VERSION,
      executionModel: {
        dataFidelity: "D1",
        spreadModel: ZeroSpread.name,
        slippageModel: ZeroSlippage.name,
        feeModel: ZeroFee.name,
        latencyModel: ZeroLatency.name,
      },
    });

    const experiment = await prisma.$transaction(async (tx) => {
      const created = await tx.walkForwardExperiment.create({
        data: {
          userId,
          strategyId: strategy.strategyId,
          strategyArtifactHash,
          symbol: request.symbol,
          timeframe: request.timeframe,
          startTime,
          endTime,
          initialBalance,
          searchSpace: searchSpace as unknown as object,
          objective,
          minEligibleTrades,
          candidateCap,
          inSampleDays: WALK_FORWARD_IN_SAMPLE_DAYS,
          outOfSampleDays: WALK_FORWARD_OUT_OF_SAMPLE_DAYS,
          stepDays: WALK_FORWARD_STEP_DAYS,
          totalFolds: folds.length,
          foldsCompleted: 0,
          status: "QUEUED",
          validationMethod: "walk-forward",
          fingerprint,
        },
      });

      await tx.walkForwardFold.createMany({
        data: folds.map((fold) => ({
          experimentId: created.id,
          foldIndex: fold.foldIndex,
          inSampleStart: fold.inSampleStart,
          inSampleEnd: fold.inSampleEnd,
          outOfSampleStart: fold.outOfSampleStart,
          outOfSampleEnd: fold.outOfSampleEnd,
          status: "UNRUN",
        })),
      });

      return created;
    });

    return toExperimentView(experiment);
  },

  /** Ownership-scoped, never leaks existence (an experiment belonging to another user resolves to null, same as a nonexistent one - the exact convention getOptimizationExperiment() already establishes). Full detail: every fold, each with its own candidates. */
  async getWalkForwardExperiment(userId: string, experimentId: string): Promise<WalkForwardExperimentDetailView | null> {
    const row = await prisma.walkForwardExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!row) return null;

    const folds = await prisma.walkForwardFold.findMany({ where: { experimentId }, orderBy: { foldIndex: "asc" } });
    const foldDetails: WalkForwardFoldDetailView[] = await Promise.all(
      folds.map(async (fold): Promise<WalkForwardFoldDetailView> => {
        // Same deterministic secondary ordering P4.9-A.4-T5 locked for
        // OptimizationCandidate (createdAt asc, candidateHash asc) -
        // reused verbatim, the same tie risk applies here (one
        // transaction creates every candidate row for a fold).
        const candidates = await prisma.walkForwardCandidate.findMany({ where: { foldId: fold.id }, orderBy: [{ createdAt: "asc" }, { candidateHash: "asc" }] });
        return { ...toFoldView(fold), candidates: candidates.map(toCandidateView) };
      }),
    );

    return {
      ...toExperimentView(row),
      searchSpace: row.searchSpace as unknown as WalkForwardParameterRange[],
      strategyArtifactHash: row.strategyArtifactHash,
      fingerprint: row.fingerprint,
      folds: foldDetails,
    };
  },

  /** Atomic QUEUED -> RUNNING, mirrors the same transition continueOptimizationExperiment() performs inline for OptimizationExperiment. A future B.3 execution loop calls this once before starting its first fold. */
  async startWalkForwardExperiment(userId: string, experimentId: string): Promise<WalkForwardExperimentView> {
    const existing = await prisma.walkForwardExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Walk-forward experiment '${experimentId}' not found.`);
    await atomicStatusTransition(prisma.walkForwardExperiment, experimentId, ["QUEUED"], { status: "RUNNING" }, () => {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Experiment '${experimentId}' is not QUEUED (current status: ${existing.status}) - cannot start.`);
    });
    return toExperimentView(await prisma.walkForwardExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },

  /**
   * Atomic conditional transition - QUEUED/RUNNING -> CANCELLED. Mirrors
   * cancelOptimizationExperiment() exactly: never touches `verdict` (no
   * verdict computation runs on cancellation, generalizing T3's own
   * locked "no winner validation runs on cancellation" rule), UNRUN
   * folds/candidates are left untouched, already-terminal ones are
   * retained.
   */
  async cancelWalkForwardExperiment(userId: string, experimentId: string): Promise<WalkForwardExperimentView | null> {
    const existing = await prisma.walkForwardExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!existing) return null;

    await prisma.walkForwardExperiment.updateMany({
      where: { id: experimentId, userId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    return toExperimentView(await prisma.walkForwardExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },

  /**
   * RUNNING -> COMPLETED, given an ALREADY-COMPUTED verdict. This service
   * never computes PASSED/FAILED/INCONCLUSIVE itself (P4.9-B-B.3's own
   * job, per the locked cross-fold aggregation rule) - it only persists
   * what the caller supplies, the same "B.2 persists what B.3 decides"
   * boundary applied to the experiment as a whole.
   */
  async completeWalkForwardExperiment(experimentId: string, result: { readonly verdict: WalkForwardVerdict; readonly passedFoldCount: number; readonly conclusiveFoldCount: number }): Promise<WalkForwardExperimentView> {
    const existing = await prisma.walkForwardExperiment.findUnique({ where: { id: experimentId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Walk-forward experiment '${experimentId}' not found.`);
    await atomicStatusTransition(
      prisma.walkForwardExperiment,
      experimentId,
      ["RUNNING"],
      { status: "COMPLETED", completedAt: new Date(), verdict: result.verdict, passedFoldCount: result.passedFoldCount, conclusiveFoldCount: result.conclusiveFoldCount },
      () => {
        throw new WalkForwardServiceError("INVALID_TRANSITION", `Experiment '${experimentId}' is not RUNNING (current status: ${existing.status}) - cannot complete.`);
      },
    );
    return toExperimentView(await prisma.walkForwardExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },

  /** RUNNING -> FAILED, given a real error message (e.g. a provider failure a future B.3 caught). Never computes a verdict - `verdict` stays null. */
  async failWalkForwardExperiment(experimentId: string, errorMessage: string): Promise<WalkForwardExperimentView> {
    const existing = await prisma.walkForwardExperiment.findUnique({ where: { id: experimentId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Walk-forward experiment '${experimentId}' not found.`);
    await atomicStatusTransition(prisma.walkForwardExperiment, experimentId, ["QUEUED", "RUNNING"], { status: "FAILED", errorMessage }, () => {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Experiment '${experimentId}' is not QUEUED/RUNNING (current status: ${existing.status}) - cannot fail.`);
    });
    return toExperimentView(await prisma.walkForwardExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },

  /** Ownership-scoped (via the parent experiment's own userId) AND parent-scoped (the fold must belong to the SAME experimentId the caller named) - the direct enforcement of "cross-parent retrieval is rejected". */
  async getWalkForwardFold(userId: string, experimentId: string, foldId: string): Promise<WalkForwardFoldDetailView | null> {
    const experiment = await prisma.walkForwardExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!experiment) return null;
    const fold = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!fold) return null;
    const candidates = await prisma.walkForwardCandidate.findMany({ where: { foldId: fold.id }, orderBy: [{ createdAt: "asc" }, { candidateHash: "asc" }] });
    return { ...toFoldView(fold), candidates: candidates.map(toCandidateView) };
  },

  /** Atomic UNRUN -> OPTIMIZING. A future B.3 execution loop calls this exactly once per fold, before claiming that fold's own first candidate. */
  async startFoldOptimizing(experimentId: string, foldId: string): Promise<WalkForwardFoldView> {
    const existing = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Fold '${foldId}' not found under experiment '${experimentId}'.`);
    await atomicStatusTransition(prisma.walkForwardFold, foldId, ["UNRUN"], { status: "OPTIMIZING" }, () => {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Fold '${foldId}' is not UNRUN (current status: ${existing.status}) - cannot start optimizing.`);
    });
    return toFoldView(await prisma.walkForwardFold.findUniqueOrThrow({ where: { id: foldId } }));
  },

  /**
   * OPTIMIZING -> VALIDATING, and CANDIDATE -> VALIDATED on the winning
   * candidate - ONE transaction, mirrors finalizeIfComplete()'s own
   * atomic winner-selection+status-transition shape exactly, minus the
   * actual SELECTION query (that decision is P4.9-B-B.3's own job,
   * reusing the identical `profitFactor desc, candidateHash asc`
   * tiebreak query optimization.service.ts already proved correct - this
   * function is called AFTER that decision is made, with an already-
   * chosen candidateId). Structural-invariant throw (mirrors
   * finalizeIfComplete()'s own `count !== 1` guard) if the target
   * candidate does not genuinely belong to this fold or is not
   * CANDIDATE-status at the moment this runs - the direct enforcement of
   * "candidate/fold transition skipping required lifecycle stages" being
   * rejected.
   */
  async setFoldWinner(experimentId: string, foldId: string, candidateId: string): Promise<WalkForwardFoldView> {
    const fold = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!fold) throw new WalkForwardServiceError("NOT_FOUND", `Fold '${foldId}' not found under experiment '${experimentId}'.`);
    // Two-step lookup, deliberately not one combined {id, foldId} query -
    // "the candidate doesn't exist at all" and "the candidate exists but
    // belongs to a different fold" are different facts and get different
    // error codes, per this tier's own locked error-contract requirement
    // to distinguish NOT_FOUND from INVALID_PARENT precisely.
    const candidate = await prisma.walkForwardCandidate.findUnique({ where: { id: candidateId } });
    if (!candidate) {
      throw new WalkForwardServiceError("NOT_FOUND", `Candidate '${candidateId}' not found.`);
    }
    if (candidate.foldId !== foldId) {
      throw new WalkForwardServiceError("INVALID_PARENT", `Candidate '${candidateId}' does not belong to fold '${foldId}' - refusing to set it as that fold's winner.`);
    }

    await prisma.$transaction(async (tx) => {
      const foldTransition = await tx.walkForwardFold.updateMany({ where: { id: foldId, status: "OPTIMIZING" }, data: { status: "VALIDATING", winnerCandidateId: candidateId } });
      if (foldTransition.count !== 1) {
        throw new WalkForwardServiceError("INVALID_TRANSITION", `Fold '${foldId}' is not OPTIMIZING (current status: ${fold.status}) - cannot set its winner.`);
      }
      const candidateTransition = await tx.walkForwardCandidate.updateMany({ where: { id: candidateId, foldId, status: "CANDIDATE" }, data: { status: "VALIDATED" } });
      if (candidateTransition.count !== 1) {
        throw new WalkForwardServiceError("INVALID_TRANSITION", `Candidate '${candidateId}' was not CANDIDATE-status (found: ${candidate.status}) at winner-selection time.`);
      }
    });

    return toFoldView(await prisma.walkForwardFold.findUniqueOrThrow({ where: { id: foldId } }));
  },

  /**
   * VALIDATING -> COMPLETED, given an ALREADY-COMPUTED OOS outcome. This
   * service never runs the OOS simulation or decides PASSED/FAILED/
   * INCONCLUSIVE itself (P4.9-B-B.3's own job) - it only persists what
   * the caller supplies.
   */
  async completeFold(experimentId: string, foldId: string, result: { readonly oosProfitFactor: number | null; readonly oosTradeCount: number; readonly oosOutcome: WalkForwardOosOutcome }): Promise<WalkForwardFoldView> {
    const existing = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Fold '${foldId}' not found under experiment '${experimentId}'.`);
    await prisma.$transaction(async (tx) => {
      const foldTransition = await tx.walkForwardFold.updateMany({
        where: { id: foldId, status: "VALIDATING" },
        data: { status: "COMPLETED", completedAt: new Date(), oosProfitFactor: result.oosProfitFactor, oosTradeCount: result.oosTradeCount, oosOutcome: result.oosOutcome },
      });
      if (foldTransition.count !== 1) {
        throw new WalkForwardServiceError("INVALID_TRANSITION", `Fold '${foldId}' is not VALIDATING (current status: ${existing.status}) - cannot complete.`);
      }
      await tx.walkForwardExperiment.update({ where: { id: experimentId }, data: { foldsCompleted: { increment: 1 } } });
    });
    return toFoldView(await prisma.walkForwardFold.findUniqueOrThrow({ where: { id: foldId } }));
  },

  /** Any non-terminal fold status -> FAILED, given a real error message. */
  async failFold(experimentId: string, foldId: string, errorMessage: string): Promise<WalkForwardFoldView> {
    const existing = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Fold '${foldId}' not found under experiment '${experimentId}'.`);
    await atomicStatusTransition(prisma.walkForwardFold, foldId, ["UNRUN", "OPTIMIZING", "VALIDATING"], { status: "FAILED", errorMessage, completedAt: new Date() }, () => {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Fold '${foldId}' is already terminal (current status: ${existing.status}) - cannot fail.`);
    });
    return toFoldView(await prisma.walkForwardFold.findUniqueOrThrow({ where: { id: foldId } }));
  },

  /**
   * Persists an ALREADY-DECIDED candidate identity (candidateHash,
   * parameterValues) - this service does NOT expand a searchSpace or
   * compute the hash itself (that is candidate GENERATION, the
   * algorithmic step explicitly reserved for P4.9-B-B.3). Parent-scoped
   * (the fold must belong to the named experiment) and duplicate-hash
   * protected two ways: a pre-check for a clean error (the behavioral
   * layer), and the DB's own `@@unique([foldId, candidateHash])`
   * constraint as the final race-safe layer (the integrity layer) - the
   * same two-layer discipline this whole program already applies
   * elsewhere (DB constraint first, service validation behavioral).
   */
  async createWalkForwardCandidate(experimentId: string, foldId: string, input: { readonly candidateHash: string; readonly parameterValues: Readonly<Record<string, number | boolean | string>> }): Promise<WalkForwardCandidateView> {
    const fold = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!fold) throw new WalkForwardServiceError("INVALID_PARENT", `Fold '${foldId}' does not belong to experiment '${experimentId}'.`);
    if (fold.status !== "OPTIMIZING") {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Fold '${foldId}' is not OPTIMIZING (current status: ${fold.status}) - cannot accept new candidates.`);
    }

    const duplicate = await prisma.walkForwardCandidate.findFirst({ where: { foldId, candidateHash: input.candidateHash } });
    if (duplicate) {
      throw new WalkForwardServiceError("DUPLICATE_CANDIDATE_HASH", `Candidate hash '${input.candidateHash}' already exists in fold '${foldId}'.`);
    }

    try {
      const created = await prisma.walkForwardCandidate.create({
        data: { foldId, candidateHash: input.candidateHash, parameterValues: input.parameterValues as unknown as object, status: "UNRUN" },
      });
      return toCandidateView(created);
    } catch (err) {
      // Race-safety net: a concurrent createWalkForwardCandidate() call
      // for the SAME hash could pass the pre-check above before either
      // commits - the DB's own @@unique constraint is the final,
      // authoritative integrity layer either way.
      if (err instanceof Error && err.message.includes("Unique constraint")) {
        throw new WalkForwardServiceError("DUPLICATE_CANDIDATE_HASH", `Candidate hash '${input.candidateHash}' already exists in fold '${foldId}'.`);
      }
      throw err;
    }
  },

  /** Ownership/parent-scoped (via the fold's own experimentId). */
  async getWalkForwardCandidate(experimentId: string, foldId: string, candidateId: string): Promise<WalkForwardCandidateView | null> {
    const fold = await prisma.walkForwardFold.findFirst({ where: { id: foldId, experimentId } });
    if (!fold) return null;
    const candidate = await prisma.walkForwardCandidate.findFirst({ where: { id: candidateId, foldId } });
    return candidate ? toCandidateView(candidate) : null;
  },

  /** Atomic UNRUN -> RUNNING. Mirrors claimNextCandidate()'s own atomic-claim shape exactly (`count===1` or the claim is a no-op, never a duplicate claim). */
  async claimWalkForwardCandidate(foldId: string, candidateId: string): Promise<WalkForwardCandidateView> {
    const existing = await prisma.walkForwardCandidate.findFirst({ where: { id: candidateId, foldId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Candidate '${candidateId}' not found under fold '${foldId}'.`);
    await atomicStatusTransition(prisma.walkForwardCandidate, candidateId, ["UNRUN"], { status: "RUNNING" }, () => {
      throw new WalkForwardServiceError("INVALID_TRANSITION", `Candidate '${candidateId}' is not UNRUN (current status: ${existing.status}) - cannot claim.`);
    });
    return toCandidateView(await prisma.walkForwardCandidate.findUniqueOrThrow({ where: { id: candidateId } }));
  },

  /**
   * RUNNING -> {REJECTED|CANDIDATE|FAILED}, given an ALREADY-DECIDED
   * outcome - this service never runs the in-sample simulation or
   * decides the outcome itself (P4.9-B-B.3's own job, mirroring
   * executeCandidate()'s own terminal write but without the runSimulation()
   * call it wraps). VALIDATED is deliberately not a reachable status
   * here - only setFoldWinner() can produce it, the same structural
   * invariant finalizeIfComplete() already locks for OptimizationCandidate
   * ("VALIDATED is reachable only via finalization").
   */
  async completeWalkForwardCandidate(foldId: string, candidateId: string, result: { readonly status: "REJECTED" | "CANDIDATE" | "FAILED"; readonly tradeCount: number | null; readonly profitFactor: number | null; readonly errorMessage: string | null }): Promise<WalkForwardCandidateView> {
    const existing = await prisma.walkForwardCandidate.findFirst({ where: { id: candidateId, foldId } });
    if (!existing) throw new WalkForwardServiceError("NOT_FOUND", `Candidate '${candidateId}' not found under fold '${foldId}'.`);
    await atomicStatusTransition(
      prisma.walkForwardCandidate,
      candidateId,
      ["RUNNING"],
      { status: result.status, tradeCount: result.tradeCount, profitFactor: result.profitFactor, errorMessage: result.errorMessage, completedAt: new Date() },
      () => {
        throw new WalkForwardServiceError("INVALID_TRANSITION", `Candidate '${candidateId}' is not RUNNING (current status: ${existing.status}) - cannot complete.`);
      },
    );
    return toCandidateView(await prisma.walkForwardCandidate.findUniqueOrThrow({ where: { id: candidateId } }));
  },
};
