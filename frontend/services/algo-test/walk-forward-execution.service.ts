// services/algo-test/walk-forward-execution.service.ts
// P4.9-B-B.3 (docs/P4.9-OPTIMIZATION-WFO.md's own locked P4.9-B-R1/R2
// contract, built directly from the P4.9-B-B.3-R reconnaissance) - the
// execution ORCHESTRATION layer on top of walk-forward.service.ts's own
// lifecycle/persistence layer (B.2/B.2.1). This file DECIDES what
// happens (which candidate runs next, what its outcome is, which
// candidate wins a fold, what a fold's OOS outcome is, what the
// experiment's own process verdict is) - it never bypasses B.2's atomic
// lifecycle methods to write a decision directly; every state transition
// below goes through walkForwardService.
//
// Deliberately a SEPARATE file from walk-forward.service.ts - B.2 was
// built with "persists what B.3 decides, never computes it" as its own
// core boundary throughout; this file is exactly the "B.3 decides" half,
// kept apart the same way P4.9-A's own file-split reasoning keeps
// concerns apart elsewhere in this program.
//
// Reuses every P4.9-A execution primitive the R1/R2/B.3 reconnaissance
// already proved reusable: getStrategyDefinition,
// SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, fetchAndPrepareBars,
// twelveDataHistoricalDataProvider, expandCandidateParameterValues,
// validateParameterValues, computeTotalCandidates, runSimulation + the
// Zero* execution-assumption primitives, computeCanonicalHash,
// OPTIMIZATION_CHUNK_BUDGET_MS/OPTIMIZATION_MIN_ELIGIBLE_TRADES (imported
// directly, never redefined - the exact same reuse B.2 already
// established for the candidate cap/eligibility constants).
//
// The one genuinely new piece of execution logic, per the B.3-R
// reconnaissance's own central finding: sliceToWindow(). Twelve Data's
// own getBars() truncates every request to whole calendar days - a
// fold's IS-end and OOS-start are only minutes apart and will
// essentially always land on the SAME calendar day, so fetching each
// sub-window separately through the real provider could let genuine OOS
// bars leak into in-sample optimization. Resolved exactly as the
// reconnaissance proposed: fetch the WHOLE experiment span ONCE per
// continue() call (never per fold, never per window - the provider and
// fetchAndPrepareBars() are both reused completely unmodified), then
// slice that ALREADY-fetched bars/indicatorSeries array to each fold's
// own exact [start, end) window by real timestamp comparison, in memory,
// with zero additional network calls.
import { runSimulation, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency, computeCanonicalHash, type OHLCVBar, type Instrument, type SimulationConfig, type Timeframe } from "at24-quant-engine";
import { getStrategyDefinition, validateParameterValues, type StrategyDefinition } from "./strategy-registry";
import { fetchAndPrepareBars, type PreparedBars } from "./run-backtest";
import { twelveDataHistoricalDataProvider } from "./historical-data/twelve-data-provider";
import { SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, toAlgoTestErrorCode } from "./algo-test.service";
import { OPTIMIZATION_CHUNK_BUDGET_MS, computeTotalCandidates, expandCandidateParameterValues } from "./optimization.service";
import { walkForwardService, WalkForwardServiceError } from "./walk-forward.service";
import type { WalkForwardCandidateView, WalkForwardExperimentView, WalkForwardFoldDetailView, WalkForwardOosOutcome, WalkForwardVerdict } from "@/types/walk-forward";

// ---------------------------------------------------------------------------
// Exact in-memory window slicing (the reconnaissance's own central fix)
// ---------------------------------------------------------------------------

export interface SlicedWindow {
  readonly bars: readonly OHLCVBar[];
  readonly indicatorSeries: ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
}

/**
 * `[windowStart, windowEnd)` - inclusive start, EXCLUSIVE end, applied
 * identically to `bars` and every indicator series. Pure, in-memory, zero
 * network calls - operates on already-fetched data only. This is the
 * exact fix the B.3-R reconnaissance's own central finding requires:
 * Twelve Data's own whole-calendar-day fetch truncation means the
 * PROVIDER cannot be trusted to return a precisely-bounded window, so
 * precision is enforced here, after the fact, against the real fetched
 * array - never by making a second, narrower provider request.
 */
export function sliceToWindow(bars: readonly OHLCVBar[], indicatorSeries: ReadonlyMap<string, readonly (number | boolean | undefined)[]>, windowStart: Date, windowEnd: Date): SlicedWindow {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const indices: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const ts = bars[i]!.timestamp;
    if (ts >= startMs && ts < endMs) indices.push(i);
  }
  const slicedBars = indices.map((i) => bars[i]!);
  const slicedSeries = new Map([...indicatorSeries].map(([key, values]) => [key, indices.map((i) => values[i])] as const));
  return { bars: slicedBars, indicatorSeries: slicedSeries };
}

// ---------------------------------------------------------------------------
// Pure decision functions - independently testable, no I/O, no B.2 calls.
// Every OOS/verdict decision this file ever makes lives here, nowhere
// else - the exact opposite of B.2, which never decides anything.
// ---------------------------------------------------------------------------

/**
 * P4.9-B-R2 locked three-valued per-fold OOS outcome. `tradeCount` below
 * `minEligibleTrades` is always INCONCLUSIVE regardless of profitFactor -
 * too little data to judge, never conflated with a genuine FAILED
 * outcome (the exact same distinction REJECTED already draws on the
 * in-sample side).
 */
export function classifyOosOutcome(tradeCount: number, profitFactor: number, minEligibleTrades: number): WalkForwardOosOutcome {
  if (tradeCount < minEligibleTrades) return "INCONCLUSIVE";
  return profitFactor > 1 ? "PASSED" : "FAILED";
}

/**
 * P4.9-B-R2 locked cross-fold verdict rule, transcribed verbatim from the
 * locked table: any FAILED fold -> experiment FAILED (regardless of what
 * else is mixed in); zero conclusive folds -> INCONCLUSIVE; otherwise
 * (every conclusive fold PASSED, and at least one is conclusive) ->
 * PASSED. Folds still pending an oosOutcome (should never happen when
 * this is called, since it is only called once every fold is terminal)
 * are defensively treated as non-conclusive, never as an implicit PASS.
 */
export function aggregateProcessVerdict(foldOosOutcomes: readonly (WalkForwardOosOutcome | null | undefined)[]): { readonly verdict: WalkForwardVerdict; readonly passedFoldCount: number; readonly conclusiveFoldCount: number } {
  const passedFoldCount = foldOosOutcomes.filter((o) => o === "PASSED").length;
  const failedFoldCount = foldOosOutcomes.filter((o) => o === "FAILED").length;
  const conclusiveFoldCount = passedFoldCount + failedFoldCount;
  const verdict: WalkForwardVerdict = failedFoldCount > 0 ? "FAILED" : conclusiveFoldCount === 0 ? "INCONCLUSIVE" : "PASSED";
  return { verdict, passedFoldCount, conclusiveFoldCount };
}

/**
 * P4.9-A's own finalizeIfComplete() tiebreak (`profitFactor desc,
 * candidateHash asc`), reused verbatim as a pure in-memory comparator -
 * only CANDIDATE-status rows within the SAME fold are ever passed in by
 * the caller below, so this never reaches across folds (P4.9-B-R1's own
 * locked "fold-local winner" rule, enforced by construction: the input
 * array itself is already fold-scoped before this function ever runs).
 */
export function pickFoldWinner(eligible: readonly WalkForwardCandidateView[]): WalkForwardCandidateView | undefined {
  if (eligible.length === 0) return undefined;
  return [...eligible].sort((a, b) => {
    const av = a.profitFactor === "Infinity" ? Number.POSITIVE_INFINITY : (a.profitFactor ?? Number.NEGATIVE_INFINITY);
    const bv = b.profitFactor === "Infinity" ? Number.POSITIVE_INFINITY : (b.profitFactor ?? Number.NEGATIVE_INFINITY);
    if (av !== bv) return bv - av;
    return a.candidateHash < b.candidateHash ? -1 : a.candidateHash > b.candidateHash ? 1 : 0;
  })[0];
}

// ---------------------------------------------------------------------------
// Execution helpers - each one runSimulation() call, then persists via a
// single B.2 lifecycle method. Never a second write path.
// ---------------------------------------------------------------------------

/**
 * One in-sample candidate. Mirrors optimization.service.ts's own
 * executeCandidate() classification exactly (tradeCount < minEligibleTrades
 * -> REJECTED, else CANDIDATE; any exception -> FAILED) - a single
 * candidate's own exception never fails the fold or the experiment (the
 * same "one of many, not the only one" reasoning executeCandidate()
 * already establishes - only ONE OOS run exists per fold, so THAT
 * exception is handled differently, see runOosValidation below).
 */
async function runInSampleCandidate(candidate: WalkForwardCandidateView, foldId: string, foldIndex: number, strategy: StrategyDefinition, isSlice: SlicedWindow, instrument: Instrument, engineTimeframe: Timeframe, initialBalance: number, minEligibleTrades: number, experimentId: string): Promise<void> {
  let status: "REJECTED" | "CANDIDATE" | "FAILED";
  let tradeCount: number | null = null;
  let profitFactor: number | null = null;
  let errorMessage: string | null = null;

  try {
    const strategySpec = strategy.buildSpec(candidate.parameterValues);
    const config: SimulationConfig = {
      strategySpec,
      instrument,
      timeframe: engineTimeframe,
      initialBalance,
      datasetId: `${twelveDataHistoricalDataProvider.id}:${instrument.symbol}:${engineTimeframe}`,
      datasetVersion: `walk-forward:${experimentId}:fold${foldIndex}:${candidate.candidateHash}`,
      dataFidelity: "D1",
      spreadModel: ZeroSpread,
      slippageModel: ZeroSlippage,
      feeModel: ZeroFee,
      latencyModel: ZeroLatency,
      indicatorSeries: isSlice.indicatorSeries,
    };
    const result = runSimulation(isSlice.bars, config);
    tradeCount = result.metrics.tradeCount ?? result.tradeLedger.length;
    profitFactor = result.metrics.profitFactor ?? 0;
    status = tradeCount < minEligibleTrades ? "REJECTED" : "CANDIDATE";
  } catch (err) {
    status = "FAILED";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await walkForwardService.completeWalkForwardCandidate(foldId, candidate.id, { status, tradeCount, profitFactor, errorMessage });
}

/**
 * The single out-of-sample validation run for a fold's already-chosen
 * winner - the exact same parameterValues that won in-sample, run once
 * against the OOS slice, never re-optimized, never a second winner
 * search. Unlike a single in-sample candidate's own exception, an
 * exception here fails the WHOLE fold (and, per the cascading decision
 * documented in this tier's own report, the whole experiment) - there is
 * only one OOS run per fold, so its own failure means this fold's
 * outcome genuinely cannot be known, not "one candidate among many."
 */
async function runOosValidation(fold: WalkForwardFoldDetailView, winner: WalkForwardCandidateView, strategy: StrategyDefinition, oosSlice: SlicedWindow, instrument: Instrument, engineTimeframe: Timeframe, initialBalance: number, minEligibleTrades: number, experimentId: string): Promise<"ok" | "technical-failure"> {
  try {
    const strategySpec = strategy.buildSpec(winner.parameterValues);
    const config: SimulationConfig = {
      strategySpec,
      instrument,
      timeframe: engineTimeframe,
      initialBalance,
      datasetId: `${twelveDataHistoricalDataProvider.id}:${instrument.symbol}:${engineTimeframe}`,
      datasetVersion: `walk-forward-oos:${experimentId}:fold${fold.foldIndex}:${winner.candidateHash}`,
      dataFidelity: "D1",
      spreadModel: ZeroSpread,
      slippageModel: ZeroSlippage,
      feeModel: ZeroFee,
      latencyModel: ZeroLatency,
      indicatorSeries: oosSlice.indicatorSeries,
    };
    const result = runSimulation(oosSlice.bars, config);
    const oosTradeCount = result.metrics.tradeCount ?? result.tradeLedger.length;
    const oosProfitFactorRaw = result.metrics.profitFactor ?? 0;
    const oosOutcome = classifyOosOutcome(oosTradeCount, oosProfitFactorRaw, minEligibleTrades);
    await walkForwardService.completeFold(experimentId, fold.id, { oosProfitFactor: oosProfitFactorRaw, oosTradeCount, oosOutcome });
    return "ok";
  } catch (err) {
    await walkForwardService.failFold(experimentId, fold.id, err instanceof Error ? err.message : String(err));
    return "technical-failure";
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export const walkForwardExecutionService = {
  /**
   * One time-budgeted chunk (reuses OPTIMIZATION_CHUNK_BUDGET_MS
   * directly, never a second constant - same 8s conservative wall-clock
   * margin, same reasoning: Vercel has no persistent background worker,
   * per R1's own original, still-binding finding). Exactly one unit of
   * work per loop iteration - generate the next missing candidate, claim
   * and run one candidate, select a fold's winner (or complete it
   * INCONCLUSIVE with no winner), run one fold's OOS validation, or
   * finalize the whole experiment - the state is always re-derived fresh
   * from the DB at the top of each iteration, so a resumed/retried call
   * picks up exactly where a prior call left off, the same resumability
   * continueOptimizationExperiment() already establishes.
   */
  async continueWalkForwardExperiment(userId: string, experimentId: string): Promise<WalkForwardExperimentView> {
    let detail = await walkForwardService.getWalkForwardExperiment(userId, experimentId);
    if (!detail) {
      throw new WalkForwardServiceError("NOT_FOUND", `Walk-forward experiment '${experimentId}' not found.`);
    }

    if (detail.status === "COMPLETED" || detail.status === "FAILED" || detail.status === "CANCELLED") {
      return detail;
    }

    if (detail.status === "QUEUED") {
      await walkForwardService.startWalkForwardExperiment(userId, experimentId);
    }

    detail = await walkForwardService.getWalkForwardExperiment(userId, experimentId);
    if (!detail || detail.status !== "RUNNING") {
      if (!detail) throw new WalkForwardServiceError("NOT_FOUND", `Walk-forward experiment '${experimentId}' not found.`);
      return detail;
    }

    const strategy = getStrategyDefinition(detail.strategyId);
    if (!strategy) {
      // Structurally shouldn't happen - registry entries are never
      // removed at runtime - but genuinely unrecoverable if it somehow
      // did, mirrors continueOptimizationExperiment()'s own identical guard.
      await walkForwardService.failWalkForwardExperiment(experimentId, `Strategy '${detail.strategyId}' is no longer registered.`);
      return (await walkForwardService.getWalkForwardExperiment(userId, experimentId))!;
    }

    const engineTimeframe = SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME[detail.timeframe];
    if (!engineTimeframe) {
      // Already validated at creation time - a typed internal-error
      // guard, not a reachable user-facing case, mirrors
      // continueOptimizationExperiment()'s own identical guard.
      throw new Error(`Internal error: experiment '${experimentId}' has timeframe '${detail.timeframe}' with no engine mapping (should have been caught at creation).`);
    }

    // P4.9-B-B.3-R lock - ONE fetch for the WHOLE experiment span, every
    // continue() call (never per fold, never per window). Reused,
    // unmodified, across every fold's IS+OOS slice within this call.
    let prepared: PreparedBars;
    try {
      prepared = await fetchAndPrepareBars({ symbol: detail.symbol, timeframe: engineTimeframe, startTime: detail.startTime, endTime: detail.endTime }, strategy.buildIndicatorSeries, twelveDataHistoricalDataProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = toAlgoTestErrorCode(message);
      if (code === "NO_HISTORICAL_DATA") {
        // Unrecoverable for this experiment's own fixed window - retrying
        // will not produce data that does not exist. Mirrors
        // continueOptimizationExperiment()'s own identical branch.
        await walkForwardService.failWalkForwardExperiment(experimentId, message);
        return (await walkForwardService.getWalkForwardExperiment(userId, experimentId))!;
      }
      // PROVIDER_ERROR - transient. Nothing was claimed yet, so the
      // experiment's own status is left untouched; the client may call
      // continue() again. Mirrors continueOptimizationExperiment()'s own
      // identical branch.
      throw new WalkForwardServiceError("PROVIDER_ERROR", message);
    }

    const instrument: Instrument = prepared.bars[0]!.instrument;
    const chunkStart = Date.now();

    while (Date.now() - chunkStart < OPTIMIZATION_CHUNK_BUDGET_MS) {
      // Locked re-check: before doing another unit of work, confirm the
      // experiment is still RUNNING (a concurrent cancel() may have
      // landed since the last iteration or since chunk start) - mirrors
      // continueOptimizationExperiment()'s own identical re-check.
      const live = await walkForwardService.getWalkForwardExperiment(userId, experimentId);
      if (!live || live.status !== "RUNNING") break;

      // P4.9-B-R1 locked - fully sequential, one fold at a time, folds in
      // strictly ascending foldIndex order (B.2's own getWalkForwardExperiment
      // already returns folds foldIndex-ordered). No parallel folds, no
      // parallel candidates.
      const currentFold = live.folds.find((f) => f.status !== "COMPLETED" && f.status !== "FAILED");

      if (!currentFold) {
        // Every fold is terminal - aggregate the locked cross-fold
        // verdict and complete the experiment. Never a global winner:
        // this aggregates OOS OUTCOMES, it never ranks or compares
        // candidates across folds.
        const { verdict, passedFoldCount, conclusiveFoldCount } = aggregateProcessVerdict(live.folds.map((f) => f.oosOutcome));
        await walkForwardService.completeWalkForwardExperiment(experimentId, { verdict, passedFoldCount, conclusiveFoldCount });
        break;
      }

      if (currentFold.status === "UNRUN") {
        await walkForwardService.startFoldOptimizing(experimentId, currentFold.id);
        continue;
      }

      if (currentFold.status === "OPTIMIZING") {
        const totalForFold = computeTotalCandidates(detail.searchSpace);

        if (currentFold.candidates.length < totalForFold) {
          // P4.9-B-B.3 lock - idempotent, resumable generation: exactly
          // the NEXT missing candidate, in the same deterministic
          // Cartesian-product order expandCandidateParameterValues()
          // already establishes - never a bulk regenerate, never relying
          // on the DUPLICATE_CANDIDATE_HASH constraint as the mechanism
          // (per the reconnaissance's own explicit requirement). A
          // resumed/retried call naturally continues from
          // currentFold.candidates.length, whatever it already is.
          const combos = expandCandidateParameterValues(detail.searchSpace);
          const rawCombo = combos[currentFold.candidates.length]!;
          const normalization = validateParameterValues(strategy, rawCombo);
          if (!normalization.ok) {
            throw new Error(`Internal error: a generated walk-forward candidate failed validateParameterValues() - ${normalization.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
          }
          const candidateHash = computeCanonicalHash({ foldId: currentFold.id, parameterValues: normalization.normalized });
          await walkForwardService.createWalkForwardCandidate(experimentId, currentFold.id, { candidateHash, parameterValues: normalization.normalized });
          continue;
        }

        const nextUnrun = currentFold.candidates.find((c) => c.status === "UNRUN");
        if (nextUnrun) {
          await walkForwardService.claimWalkForwardCandidate(currentFold.id, nextUnrun.id);
          const isSlice = sliceToWindow(prepared.bars, prepared.indicatorSeries, new Date(currentFold.inSampleStart), new Date(currentFold.inSampleEnd));
          await runInSampleCandidate({ ...nextUnrun, status: "RUNNING" }, currentFold.id, currentFold.foldIndex, strategy, isSlice, instrument, engineTimeframe, detail.initialBalance, detail.minEligibleTrades, experimentId);
          continue;
        }

        // Every candidate in this fold has reached a terminal in-sample
        // state - select the fold-local winner (P4.9-B-R1 locked:
        // ONLY among this fold's own eligible candidates, never across
        // folds - eligible below is already fold-scoped by construction,
        // it can never reach another fold's rows).
        const eligible = currentFold.candidates.filter((c) => c.status === "CANDIDATE");
        const winner = pickFoldWinner(eligible);
        if (winner) {
          await walkForwardService.setFoldWinner(experimentId, currentFold.id, winner.id);
        } else {
          // P4.9-B-B.2.1 locked path - no eligible candidate, no OOS run
          // ever happens, the fold completes directly as INCONCLUSIVE.
          await walkForwardService.completeFold(experimentId, currentFold.id, { oosProfitFactor: null, oosTradeCount: null, oosOutcome: "INCONCLUSIVE" });
        }
        continue;
      }

      if (currentFold.status === "VALIDATING") {
        const winnerCandidate = currentFold.candidates.find((c) => c.id === currentFold.winnerCandidateId);
        if (!winnerCandidate) {
          // setFoldWinner() already guarantees this candidate exists and
          // belongs to this fold - a structural invariant violation here
          // is never silently skipped past, mirrors finalizeIfComplete()'s
          // own identical discipline for its own structural guard.
          throw new Error(`Internal error: fold '${currentFold.id}' is VALIDATING with winnerCandidateId '${currentFold.winnerCandidateId}' but no matching candidate was found - should be structurally unreachable.`);
        }
        const oosSlice = sliceToWindow(prepared.bars, prepared.indicatorSeries, new Date(currentFold.outOfSampleStart), new Date(currentFold.outOfSampleEnd));
        const outcome = await runOosValidation(currentFold, winnerCandidate, strategy, oosSlice, instrument, engineTimeframe, detail.initialBalance, detail.minEligibleTrades, experimentId);
        if (outcome === "technical-failure") {
          // Only ONE OOS run exists per fold (unlike an in-sample
          // candidate, one of many) - its own failure means this fold's
          // outcome genuinely cannot be known, so it cascades to failing
          // the whole experiment rather than leaving a silently
          // unknowable fold behind. A reasoned B.3 decision, not implied
          // by anything already locked - flagged explicitly in this
          // tier's own report.
          await walkForwardService.failWalkForwardExperiment(experimentId, `Fold ${currentFold.foldIndex} failed during out-of-sample validation.`);
          break;
        }
        continue;
      }
    }

    return (await walkForwardService.getWalkForwardExperiment(userId, experimentId))!;
  },
};
