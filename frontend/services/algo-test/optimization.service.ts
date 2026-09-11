// services/algo-test/optimization.service.ts
// P4.9-A.2 - Algo Testing Pro's own registry-strategy parameter
// optimization (P4.9-R1/R2 locked contract, P4.9-A.2 locked service
// contract). Deliberately a SEPARATE file from algo-test.service.ts (a
// locked design decision) - a genuinely separate concern that reuses that
// file's existing, unmodified primitives (getStrategyDefinition,
// validateParameterValues, maxRangeDaysFor, the timeframe map, error
// classification) rather than a second copy of any of them.
//
// No new execution engine: every candidate runs through the exact same
// at24-quant-engine runSimulation() every ordinary Algo Test run already
// uses (via run-backtest.ts's own fetchAndPrepareBars(), extracted in this
// same tier so there is exactly one implementation of the bars-fetch/
// warmup-slice logic, not two). The one real behavioral difference from an
// ordinary run: bars/indicatorSeries are fetched ONCE per chunk and reused
// across every candidate that chunk processes (never once per candidate -
// a 256-candidate sweep would otherwise mean 256 live Twelve Data calls).
import { runSimulation, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency, RUNTIME_VERSION, computeCanonicalHash, type Instrument, type SimulationConfig, type Timeframe } from "at24-quant-engine";
import { prisma } from "@/lib/prisma";
import { getStrategyDefinition, validateParameterValues, type StrategyDefinition } from "./strategy-registry";
import { fetchAndPrepareBars, type PreparedBars } from "./run-backtest";
import { twelveDataHistoricalDataProvider } from "./historical-data/twelve-data-provider";
import { DEFAULT_INITIAL_BALANCE, maxRangeDaysFor, SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, toAlgoTestErrorCode } from "./algo-test.service";
import type {
  CreateOptimizationExperimentRequest,
  OptimizationCandidateStatus,
  OptimizationCandidateView,
  OptimizationErrorCode,
  OptimizationExperimentDetailView,
  OptimizationExperimentStatus,
  OptimizationExperimentView,
  OptimizationParameterRange,
  OptimizationProfitFactor,
} from "@/types/optimization";

// P4.9-R2 locked, never user-configurable in v1 - see
// docs/P4.9-OPTIMIZATION-WFO.md.
export const OPTIMIZATION_CANDIDATE_CAP = 256;
export const OPTIMIZATION_MIN_ELIGIBLE_TRADES = 20;
// P4.9-A.2 locked (E) - wall-clock, not candidate-count. Deliberately not
// coupled to any specific Vercel maxDuration value - the service stays
// correct even if the platform's real limit differs; this is a
// conservative safety margin, not a derived platform constant.
export const OPTIMIZATION_CHUNK_BUDGET_MS = 8_000;

/**
 * A candidate's terminal `status` values reached WITHOUT going through
 * finalization. "RUNNING" is claimed-but-not-yet-terminal (P4.9-A.1's own
 * disclosed DB-only addition to the engine's ResearchResultStatus
 * vocabulary). "VALIDATED" is reachable ONLY via finalization (TX3) -
 * never assigned here.
 */
type CandidateExecutionStatus = "FAILED" | "REJECTED" | "CANDIDATE";

export class OptimizationServiceError extends Error {
  constructor(
    readonly code: OptimizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OptimizationServiceError";
  }
}

// ---------------------------------------------------------------------------
// Search-space validation + candidate generation
// ---------------------------------------------------------------------------

interface ValidatedOptimizationRequest {
  readonly strategy: StrategyDefinition;
  readonly engineTimeframe: Timeframe;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialBalance: number;
  readonly searchSpace: readonly OptimizationParameterRange[];
}

/**
 * Mirrors algo-test.service.ts's own validateRequest() ordering (strategy
 * -> symbol -> timeframe -> dates -> balance -> searchSpace) and reuses
 * every existing primitive it can (getStrategyDefinition,
 * SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, maxRangeDaysFor,
 * DEFAULT_INITIAL_BALANCE) - a deliberate choice NOT to extract a single
 * shared "validateBacktestWindow" helper spanning both files, since the
 * two request shapes (AlgoTestRunRequest vs CreateOptimizationExperimentRequest)
 * differ enough that a shared helper would need its own parameter-passing
 * complexity; every actual CHECK below is a real primitive call, not a
 * duplicated algorithm - only the orchestration (a handful of lines) is
 * written twice. Flagging this choice rather than assuming it's obviously
 * fine.
 */
function validateCreateRequest(request: CreateOptimizationExperimentRequest): { readonly code: OptimizationErrorCode; readonly message: string } | ValidatedOptimizationRequest {
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
  const rangeDays = (endTime.getTime() - startTime.getTime()) / 86_400_000;
  const maxRangeDays = maxRangeDaysFor(engineTimeframe);
  if (rangeDays > maxRangeDays) {
    return { code: "RANGE_TOO_LARGE", message: `Date range spans ${rangeDays.toFixed(1)} days; the maximum supported range for ${engineTimeframe} is ${maxRangeDays} days.` };
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
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}' is not a numeric parameter - only number/integer parameters can be swept in v1.` };
    }
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || !Number.isFinite(range.step) || range.step <= 0) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min/max/step must be finite numbers and step must be > 0.` };
    }
    if (range.min > range.max) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min (${range.min}) must be <= max (${range.max}).` };
    }
    // step required for search-space admission even though the registry's
    // own StrategyParameterDefinition.step is optional (P4.9-A audit,
    // point 2) - already enforced structurally above (OptimizationParameterRange.step
    // is a required field, not optional, at the type level).
    if (param.min !== undefined && range.min < param.min) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': min (${range.min}) is below the parameter's own declared minimum (${param.min}).` };
    }
    if (param.max !== undefined && range.max > param.max) {
      return { code: "INVALID_SEARCH_SPACE", message: `Parameter '${range.parameterId}': max (${range.max}) is above the parameter's own declared maximum (${param.max}).` };
    }
  }

  return { strategy, engineTimeframe, startTime, endTime, initialBalance, searchSpace: request.searchSpace };
}

/** Floating-point-safe step count, same discipline as validateParameterValues()'s own "never fail on float noise" check. */
function stepCountFor(range: OptimizationParameterRange): number {
  return Math.floor((range.max - range.min) / range.step + 1e-9) + 1;
}

/** Empty searchSpace -> 1 (a degenerate, allowed single candidate at every parameter's own default - not special-cased, see the A.2 audit). */
export function computeTotalCandidates(searchSpace: readonly OptimizationParameterRange[]): number {
  return searchSpace.reduce((total, range) => total * stepCountFor(range), 1);
}

/**
 * Full Cartesian product, one entry per candidate, in `searchSpace` order -
 * matches computeTotalCandidates() exactly. Values for unswept parameters
 * are NOT filled in here (see fillDefaults below - reuses
 * validateParameterValues()'s own normalization, never a second "fill
 * defaults" implementation).
 *
 * P4.9-B-B.3 - exported (was module-private). WalkForwardParameterRange
 * (types/walk-forward.ts) is structurally identical to
 * OptimizationParameterRange (same parameterId/min/max/step shape, by
 * design - P4.9-B-R2 locked reuse), so B.3's own per-fold candidate
 * generation calls this SAME function directly rather than duplicating
 * the Cartesian-product logic - the smallest justified visibility change,
 * zero behavior change to this function itself.
 */
export function expandCandidateParameterValues(searchSpace: readonly OptimizationParameterRange[]): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}];
  for (const range of searchSpace) {
    const values: number[] = [];
    const count = stepCountFor(range);
    for (let i = 0; i < count; i++) values.push(range.min + i * range.step);
    const next: Record<string, number>[] = [];
    for (const combo of combos) {
      for (const v of values) next.push({ ...combo, [range.parameterId]: v });
    }
    combos = next;
  }
  return combos;
}

/** computeCanonicalHash({experimentId, parameterValues}) - the P4.9-R2 locked deterministic candidate identity. */
function computeCandidateHash(experimentId: string, parameterValues: Readonly<Record<string, number | boolean | string>>): string {
  return computeCanonicalHash({ experimentId, parameterValues });
}

/** The P4.9-A.2 locked fingerprint shape - "under exactly what conditions was this optimized," distinct from strategyArtifactHash's "what was optimized." */
function computeExperimentFingerprint(input: {
  readonly strategyId: string;
  readonly strategyArtifactHash: string;
  readonly searchSpace: readonly OptimizationParameterRange[];
  readonly objective: string;
  readonly minEligibleTrades: number;
  readonly candidateCap: number;
  readonly symbol: string;
  readonly timeframe: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly initialBalance: number;
}): string {
  return computeCanonicalHash({
    ...input,
    engineVersion: RUNTIME_VERSION,
    executionModel: {
      dataFidelity: "D1",
      spreadModel: ZeroSpread.name,
      slippageModel: ZeroSlippage.name,
      feeModel: ZeroFee.name,
      latencyModel: ZeroLatency.name,
    },
  });
}

/** `number | "Infinity" | null` wire format - JSON.stringify(Infinity) === "null", so raw JS Infinity is never sent. Locked in the original P4.9-A design pass. */
function serializeProfitFactor(value: number | null | undefined): OptimizationProfitFactor {
  if (value === null || value === undefined) return null;
  return value === Number.POSITIVE_INFINITY ? "Infinity" : value;
}

// ---------------------------------------------------------------------------
// View projections
// ---------------------------------------------------------------------------

type ExperimentRow = Awaited<ReturnType<typeof prisma.optimizationExperiment.findFirstOrThrow>>;
type CandidateRow = Awaited<ReturnType<typeof prisma.optimizationCandidate.findFirstOrThrow>>;

function toExperimentView(row: ExperimentRow): OptimizationExperimentView {
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
    totalCandidates: row.totalCandidates,
    processedCandidates: row.processedCandidates,
    status: row.status as OptimizationExperimentStatus,
    bestCandidateId: row.bestCandidateId,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
  };
}

function toCandidateView(row: CandidateRow): OptimizationCandidateView {
  return {
    id: row.id,
    candidateHash: row.candidateHash,
    parameterValues: row.parameterValues as unknown as Record<string, number | boolean | string>,
    status: row.status as OptimizationCandidateStatus,
    tradeCount: row.tradeCount,
    profitFactor: serializeProfitFactor(row.profitFactor),
    errorMessage: row.errorMessage,
    completedAt: row.completedAt?.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const optimizationService = {
  async createOptimizationExperiment(userId: string, request: CreateOptimizationExperimentRequest): Promise<OptimizationExperimentView> {
    const validated = validateCreateRequest(request);
    if (!("strategy" in validated)) {
      throw new OptimizationServiceError(validated.code, validated.message);
    }
    const { strategy, startTime, endTime, initialBalance, searchSpace } = validated;
    // engineTimeframe is deliberately not persisted here - continueOptimizationExperiment
    // re-derives it from the stored `timeframe` string every call, same
    // convention as AlgoTestRun.timeframe (the signal-facing string is the
    // persisted source of truth, the engine token is always re-derived).

    const totalCandidates = computeTotalCandidates(searchSpace);
    if (totalCandidates > OPTIMIZATION_CANDIDATE_CAP) {
      throw new OptimizationServiceError("TOO_MANY_CANDIDATES", `This search space resolves to ${totalCandidates} candidates, exceeding the maximum of ${OPTIMIZATION_CANDIDATE_CAP} per experiment.`);
    }

    // The strategy's own registry-load-time fingerprint of its DEFAULT
    // StrategySpec (strategy-registry.ts's own StrategyReproducibility doc
    // comment) - the exact "strategyArtifactHash" the P4.9-A.1 schema
    // needs. Read directly, never recomputed - one source of truth.
    const strategyArtifactHash = strategy.reproducibility.baseContentHash;
    const objective = "profitFactor";
    const minEligibleTrades = OPTIMIZATION_MIN_ELIGIBLE_TRADES;
    const candidateCap = OPTIMIZATION_CANDIDATE_CAP;

    const fingerprint = computeExperimentFingerprint({
      strategyId: strategy.strategyId,
      strategyArtifactHash,
      searchSpace,
      objective,
      minEligibleTrades,
      candidateCap,
      symbol: request.symbol,
      timeframe: request.timeframe,
      startTime: request.startTime,
      endTime: request.endTime,
      initialBalance,
    });

    const parameterValueCombos = expandCandidateParameterValues(searchSpace);

    // TX1 (P4.9-A.2 correction #3) - interactive transaction: the second
    // write needs the first write's generated id, which an array-style
    // $transaction cannot provide.
    const experiment = await prisma.$transaction(async (tx) => {
      const created = await tx.optimizationExperiment.create({
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
          totalCandidates,
          processedCandidates: 0,
          status: "QUEUED",
          fingerprint,
        },
      });

      const candidateRows = parameterValueCombos.map((rawValues) => {
        // Fills in every declared-but-unswept parameter's own defaultValue
        // - reuses validateParameterValues()'s own normalization (the SAME
        // function runAlgoTest() uses), never a hand-rolled second
        // "fill defaults" implementation. rawValues are already known to be
        // in-range (validated above against the parameter's own min/max) -
        // an `ok: false` result here would indicate a real internal bug,
        // never silently papered over by falling back to the unvalidated
        // raw values.
        const normalization = validateParameterValues(strategy, rawValues);
        if (!normalization.ok) {
          throw new Error(`Internal error: a generated optimization candidate failed validateParameterValues() - ${normalization.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
        }
        return {
          experimentId: created.id,
          candidateHash: computeCandidateHash(created.id, normalization.normalized),
          parameterValues: normalization.normalized as object,
          status: "UNRUN",
        };
      });

      await tx.optimizationCandidate.createMany({ data: candidateRows });

      return created;
    });

    return toExperimentView(experiment);
  },

  async getOptimizationExperiment(userId: string, experimentId: string): Promise<OptimizationExperimentDetailView | null> {
    const row = await prisma.optimizationExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!row) return null;
    // P4.9-A.4-T5 lock - candidateHash added as a deterministic secondary
    // sort key. All of one experiment's candidate rows are created inside
    // the SAME transaction as the experiment itself (TX1, one createMany
    // call) - Postgres's now() (what @default(now()) compiles to) is fixed
    // for the whole transaction, so every row's createdAt is very likely
    // identical, leaving createdAt-only ordering with no real tiebreak.
    // candidateHash is already the canonical deterministic candidate
    // identity (computeCanonicalHash({experimentId, parameterValues}) -
    // the exact same field finalizeIfComplete()'s own winner-selection
    // tiebreak already uses) - reusing it here is presentation ordering
    // ONLY, structurally separate from and with zero effect on that
    // winner-selection query or its own tiebreak.
    const candidates = await prisma.optimizationCandidate.findMany({ where: { experimentId }, orderBy: [{ createdAt: "asc" }, { candidateHash: "asc" }] });
    return {
      ...toExperimentView(row),
      searchSpace: row.searchSpace as unknown as OptimizationParameterRange[],
      strategyArtifactHash: row.strategyArtifactHash,
      fingerprint: row.fingerprint,
      candidates: candidates.map(toCandidateView),
    };
  },

  /**
   * One time-budgeted chunk (P4.9-A.2 §E, locked at 8s wall-clock, not
   * candidate count). Ordering, exactly as locked:
   *   check budget -> claim -> execute -> persist terminal + increment (TX2)
   *   -> finalize check (TX3) -> re-check cancellation -> loop
   * A claimed candidate always runs to its own terminal persistence -
   * never aborted mid-flight, even if the budget or a cancellation arrives
   * while it's executing (locked).
   */
  async continueOptimizationExperiment(userId: string, experimentId: string): Promise<OptimizationExperimentView> {
    const experiment = await prisma.optimizationExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!experiment) {
      throw new OptimizationServiceError("NOT_FOUND", `Optimization experiment '${experimentId}' not found.`);
    }

    // Terminal states are a harmless no-op - a polling client never needs
    // special-case handling just because it kept polling past the end.
    if (experiment.status === "COMPLETED" || experiment.status === "FAILED" || experiment.status === "CANCELLED") {
      return toExperimentView(experiment);
    }

    if (experiment.status === "QUEUED") {
      await prisma.optimizationExperiment.updateMany({ where: { id: experimentId, status: "QUEUED" }, data: { status: "RUNNING" } });
      // Whether this call won that race or a concurrent one did (or a
      // concurrent cancel() won instead), re-read below reflects the real
      // current state either way - no branch needed here.
    }

    const fresh = await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId } });
    if (fresh.status !== "RUNNING") return toExperimentView(fresh);

    const strategy = getStrategyDefinition(fresh.strategyId);
    if (!strategy) {
      // Structurally shouldn't happen - registry entries are never removed
      // at runtime - but genuinely unrecoverable if it somehow did (no
      // buildSpec to run any candidate against).
      await prisma.optimizationExperiment.updateMany({
        where: { id: experimentId, status: "RUNNING" },
        data: { status: "FAILED", errorMessage: `Strategy '${fresh.strategyId}' is no longer registered.` },
      });
      return toExperimentView(await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
    }

    const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[fresh.timeframe];
    if (!engineTimeframe) {
      // Already validated at creation time - a typed internal-error guard,
      // not a reachable user-facing case, same "never a silent NaN"
      // discipline as maxRangeDaysFor()'s own guard.
      throw new Error(`Internal error: experiment '${experimentId}' has timeframe '${fresh.timeframe}' with no engine mapping (should have been caught at creation).`);
    }

    let prepared: PreparedBars;
    try {
      prepared = await fetchAndPrepareBars({ symbol: fresh.symbol, timeframe: engineTimeframe, startTime: fresh.startTime.toISOString(), endTime: fresh.endTime.toISOString() }, strategy.buildIndicatorSeries, twelveDataHistoricalDataProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = toAlgoTestErrorCode(message);
      if (code === "NO_HISTORICAL_DATA") {
        // Unrecoverable for this experiment's own fixed window - retrying
        // will not produce data that does not exist.
        await prisma.optimizationExperiment.updateMany({ where: { id: experimentId, status: "RUNNING" }, data: { status: "FAILED", errorMessage: message } });
        return toExperimentView(await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
      }
      // PROVIDER_ERROR - transient (rate-limit/auth/transport). Nothing was
      // claimed yet, so the experiment's own status is left untouched; the
      // client may call continue() again.
      throw new OptimizationServiceError("PROVIDER_ERROR", message);
    }

    const instrument: Instrument = prepared.bars[0]!.instrument;
    const chunkStart = Date.now();

    while (Date.now() - chunkStart < OPTIMIZATION_CHUNK_BUDGET_MS) {
      // Locked re-check: before claiming another candidate, confirm the
      // experiment is still RUNNING (a concurrent cancel() may have landed
      // since the last iteration, or since chunk start).
      const liveStatus = await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId }, select: { status: true } });
      if (liveStatus.status !== "RUNNING") break;

      const candidate = await claimNextCandidate(experimentId);
      if (!candidate) break; // no UNRUN candidates left

      await executeCandidate(candidate, strategy, prepared, instrument, engineTimeframe, fresh.initialBalance, fresh.minEligibleTrades, experimentId);
      await finalizeIfComplete(experimentId, fresh.totalCandidates);
    }

    return toExperimentView(await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },

  /**
   * Atomic conditional transition (OP4) - QUEUED/RUNNING -> CANCELLED. The
   * `WHERE status IN (...)` is what makes this mutually exclusive with
   * TX3's own finalization ownership-acquiring update: whichever commits
   * first makes the other's WHERE clause match nothing, so an experiment
   * can never end up CANCELLED after already being COMPLETED, or vice
   * versa. Per the locked cancellation semantics: no new candidate claims
   * after this commits (honored at chunk granularity - see
   * continueOptimizationExperiment's own re-check), already-COMPLETED
   * candidates are retained, UNRUN candidates are left untouched,
   * bestCandidateId is never touched, no winner validation runs.
   */
  async cancelOptimizationExperiment(userId: string, experimentId: string): Promise<OptimizationExperimentView | null> {
    const existing = await prisma.optimizationExperiment.findFirst({ where: { id: experimentId, userId } });
    if (!existing) return null;

    await prisma.optimizationExperiment.updateMany({
      where: { id: experimentId, userId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    return toExperimentView(await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: experimentId } }));
  },
};

// ---------------------------------------------------------------------------
// Chunk-internal helpers
// ---------------------------------------------------------------------------

/** OP1 - the locked atomic claim. */
async function claimNextCandidate(experimentId: string): Promise<CandidateRow | null> {
  const next = await prisma.optimizationCandidate.findFirst({ where: { experimentId, status: "UNRUN" }, orderBy: { createdAt: "asc" } });
  if (!next) return null;
  const claimed = await prisma.optimizationCandidate.updateMany({ where: { id: next.id, status: "UNRUN" }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) return null; // lost the race to a concurrent chunk - not this call's candidate, skip
  return { ...next, status: "RUNNING" };
}

/**
 * Execute one already-claimed candidate to its own terminal persistence
 * (TX2). Direct runSimulation() - once, not twice (runBacktest()'s own
 * per-run reproducibility self-check is deliberately not repeated per
 * candidate, a disclosed scope reduction - see the P4.9-A.2 audit). A
 * thrown exception anywhere in this function's own try block always
 * produces a FAILED write; the candidate is never left without a terminal
 * write from this function's own execution (the one disclosed, accepted
 * residual gap - K - is a process kill DURING this function, which no
 * try/catch inside the same process can cover).
 */
async function executeCandidate(candidate: CandidateRow, strategy: StrategyDefinition, prepared: PreparedBars, instrument: Instrument, engineTimeframe: Timeframe, initialBalance: number, minEligibleTrades: number, experimentId: string): Promise<void> {
  let status: CandidateExecutionStatus;
  let tradeCount: number | null = null;
  let profitFactor: number | null = null;
  let errorMessage: string | null = null;

  try {
    const strategySpec = strategy.buildSpec(candidate.parameterValues as unknown as Record<string, number | boolean | string>);
    const config: SimulationConfig = {
      strategySpec,
      instrument,
      timeframe: engineTimeframe,
      initialBalance,
      datasetId: `${twelveDataHistoricalDataProvider.id}:${instrument.symbol}:${engineTimeframe}`,
      datasetVersion: `optimization:${experimentId}:${candidate.candidateHash}`,
      dataFidelity: "D1",
      spreadModel: ZeroSpread,
      slippageModel: ZeroSlippage,
      feeModel: ZeroFee,
      latencyModel: ZeroLatency,
      indicatorSeries: prepared.indicatorSeries,
    };
    const result = runSimulation(prepared.bars, config);
    // MetricSet's own fields are structurally optional (Partial<Record<...>>
    // - Q0.2.14's own "reserving the shape" convention), even though
    // computeCoreMetrics() always populates both for a real run. Same
    // fallback convention algo-test.service.ts's own toMetricsView() already
    // uses for the identical reason - never a silent `undefined` reaching
    // the REJECTED/CANDIDATE decision below.
    tradeCount = result.metrics.tradeCount ?? result.tradeLedger.length;
    profitFactor = result.metrics.profitFactor ?? 0;
    status = tradeCount < minEligibleTrades ? "REJECTED" : "CANDIDATE";
  } catch (err) {
    status = "FAILED";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // TX2 (locked) - terminal write + progress increment commit together,
  // never one without the other.
  await prisma.$transaction([
    prisma.optimizationCandidate.update({ where: { id: candidate.id }, data: { status, tradeCount, profitFactor, errorMessage, completedAt: new Date() } }),
    prisma.optimizationExperiment.update({ where: { id: experimentId }, data: { processedCandidates: { increment: 1 } } }),
  ]);
}

/**
 * TX3, the corrected finalization shape (P4.9-A.2 lock): completion
 * ownership, winner selection, CANDIDATE -> VALIDATED, bestCandidateId,
 * and the terminal COMPLETED write all commit together or not at all - no
 * externally observable half-finalized experiment. `count === 1` on the
 * ownership-acquiring update is what makes exactly one caller (across any
 * number of concurrent continue() calls) the finalizer - ordinary Postgres
 * MVCC, no raw SQL.
 */
async function finalizeIfComplete(experimentId: string, totalCandidates: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const owned = await tx.optimizationExperiment.updateMany({
      where: { id: experimentId, status: "RUNNING", processedCandidates: totalCandidates },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (owned.count !== 1) return; // not this caller's job - already finalized, or not yet time

    const [winner] = await tx.optimizationCandidate.findMany({
      where: { experimentId, status: "CANDIDATE" },
      orderBy: [{ profitFactor: "desc" }, { candidateHash: "asc" }],
      take: 1,
    });

    if (!winner) return; // every candidate REJECTED/FAILED - bestCandidateId stays null, already COMPLETED above

    // Conditional real-row transition (P4.9-A.2 correction #1) - no
    // ResearchResult stand-in. The invariant ("only CANDIDATE -> VALIDATED,
    // only this transaction") is enforced directly against the persisted
    // aggregate, not borrowed from a differently-shaped domain type.
    const validated = await tx.optimizationCandidate.updateMany({ where: { id: winner.id, experimentId, status: "CANDIDATE" }, data: { status: "VALIDATED" } });
    if (validated.count !== 1) {
      throw new Error(`Internal error: winner candidate '${winner.id}' was not CANDIDATE at validation time inside the exclusive finalization transaction - this should be structurally unreachable.`);
    }

    await tx.optimizationExperiment.update({ where: { id: experimentId }, data: { bestCandidateId: winner.id } });
  });
}
