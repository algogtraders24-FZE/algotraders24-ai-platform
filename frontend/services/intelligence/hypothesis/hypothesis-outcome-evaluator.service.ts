// services/intelligence/hypothesis/hypothesis-outcome-evaluator.service.ts
// Sprint D2.5.4 - Hypothesis Outcome & Historical Validation Engine.
//
// NON-NEGOTIABLE PRINCIPLE (see docs/architecture/D2.5.4-hypothesis-
// outcome-validation-spec.md §12): a historical analysis is evaluated
// against what actually happened after it, using only information that
// became available after the analysis window - NEVER by recalculating the
// original analysis with today's data. Concretely:
//   - `creationPrice` is read directly from the persisted
//     HypothesisSnapshot.marketState.snapshot.price - the REAL price
//     recorded at creation time - never re-derived from a freshly fetched
//     series.
//   - Every invalidation check reads the hypothesis's own STORED
//     `invalidationCondition.referenceValue` (e.g. the real breakout
//     boundary at creation time) - never a boundary recalculated from
//     today's MarketState.
//   - The only new computation this file ever performs is reconstructing
//     a MarketState AT THE HISTORICAL EVALUATION BOUNDARY (not today) by
//     feeding real historical candles into the unmodified, existing
//     MarketStateService - reuse, not a new indicator engine.
//
// Distinct from services/intelligence/memory/outcome-evaluator.service.ts
// (D2.5.1), which is completely unchanged and still only ever produces
// pending/inconclusive for runs with no hypothesis. This evaluator is the
// one that reaches real validated/invalidated verdicts, and only when a
// run has a real D2.5.4 hypothesisSnapshot.
//
// No scheduler: exactly like D2.5.1, this exposes plain callable methods
// (evaluateHypothesis/evaluateAnalysisRun/evaluatePendingAnalysisRun) for
// a future cron/route to invoke - no queue/worker/Redis/BullMQ is added
// here, per the sprint's explicit instruction.
//
// Immutability: this service NEVER calls
// IntelligenceAnalysisOutcomeService.updateOutcomeStatus() on an
// already-finalized outcome. Every evaluation attempt appends a new
// outcome row via createOutcome() - historical evidence is never mutated
// in place. A future correction mechanism (for a genuine provider/data
// error) would need its own explicit, traceable superseding-record design
// - not built here, see the architecture doc §13.
import type { Clock } from "@/lib/market-data/cache";
import { systemClock } from "@/lib/market-data/cache";
import type { TimeSeriesProvider } from "@/types/market-data-provider";
import type { Candle } from "@/types/market-candle";
import type { SignalTimeframe } from "@/types/signal";
import type { Hypothesis, InvalidationCondition, PredictionWindow } from "@/types/intelligence-hypothesis";
import type { MarketState } from "@/types/intelligence-market-state";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { IntelligenceAnalysisOutcome, IntelligenceAnalysisOutcomeStatus } from "@/types/intelligence-analysis-outcome";
import { MarketStateService, INTELLIGENCE_ENGINE_VERSION } from "../market-state/market-state.service";
import { IntelligenceAnalysisRunService } from "../memory/analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "../memory/analysis-outcome.service";

export const HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION = INTELLIGENCE_ENGINE_VERSION;

// Candle-count-to-milliseconds and SignalTimeframe-to-provider-interval
// mappings. Neither exists elsewhere in the codebase (confirmed by audit -
// trading-copilot.service.ts's `interval` is already in provider format,
// never converted from SignalTimeframe) - this is real, necessary glue
// code to call the existing, unmodified TimeSeriesProvider correctly, not
// a new data source.
const TIMEFRAME_MS: Record<SignalTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

const PROVIDER_INTERVAL: Record<SignalTimeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

// Extra lookback beyond the prediction window, so there are enough real
// candles BEFORE the evaluation boundary to reconstruct a real MarketState
// there (EMA50 needs >=50 candles) - matches
// MarketStateService's own EMA_SLOW_PERIOD, plus margin.
const EVALUATION_LOOKBACK_BUFFER_CANDLES = 60;

export type HypothesisEvaluationSource =
  | "historical-candle"
  | "window-not-closed"
  | "insufficient-historical-data"
  | "provider-unavailable"
  | "no-hypothesis-snapshot";

/** Machine-auditable, JSON-serialized into IntelligenceAnalysisOutcome.evaluationBasis - never just a sentence. */
export interface HypothesisEvaluationBasis {
  source: HypothesisEvaluationSource;
  creationPrice?: number;
  evaluationPrice?: number;
  evaluationWindow?: { candles: number; timeframe: string; dueAt: string };
  invalidationObserved?: boolean;
  ruleVersion: string;
  detail: string;
}

function candlesToMs(candles: number, timeframe: SignalTimeframe): number {
  return candles * TIMEFRAME_MS[timeframe];
}

function evaluationDueAt(createdAt: string, window: PredictionWindow): Date {
  return new Date(new Date(createdAt).getTime() + candlesToMs(window.candles, window.timeframe));
}

/** Dot-path field reader over a MarketState, e.g. "structure.trend.direction", "structure.volatilityBand". */
function readField(state: MarketState, field: string): unknown {
  const parts = field.split(".");
  let cur: unknown = state;
  for (const part of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** True when the stored InvalidationCondition is BREACHED (hypothesis invalidated) given a real, historically-reconstructed field value. Point-in-time comparators only ("crosses-*" is handled separately by scanning candles - see evaluateHypothesis). */
function pointInTimeBreach(actual: unknown, cond: InvalidationCondition): boolean {
  const actualStr = actual === undefined ? "undefined" : String(actual);
  const refStr = String(cond.referenceValue);
  return cond.comparator === "not-equals" ? actualStr !== refStr : actualStr === refStr;
}

export interface HypothesisEvaluationResult {
  status: IntelligenceAnalysisOutcomeStatus;
  actualPriceMovePct: number | null;
  evaluationBasis: string; // JSON.stringify(HypothesisEvaluationBasis)
}

export interface EvaluateHypothesisInput {
  hypothesis: Hypothesis;
  /** The REAL MarketState as it existed at creation time - read from the persisted HypothesisSnapshot, never recomputed. */
  marketStateAtCreation: MarketState;
  /** The REAL IntelligenceAnalysisRun.createdAt. */
  createdAt: string;
  timeSeriesProvider: TimeSeriesProvider;
  clock?: Clock;
}

export class HypothesisOutcomeEvaluatorService {
  private readonly marketStateSvc = new MarketStateService();
  private readonly runs: IntelligenceAnalysisRunService;
  private readonly outcomes: IntelligenceAnalysisOutcomeService;

  constructor(deps?: { runs?: IntelligenceAnalysisRunService; outcomes?: IntelligenceAnalysisOutcomeService }) {
    this.runs = deps?.runs ?? new IntelligenceAnalysisRunService();
    this.outcomes = deps?.outcomes ?? new IntelligenceAnalysisOutcomeService();
  }

  /** Evaluates ONE hypothesis against real historical data. Never persists anything itself - pure computation, callable standalone or via evaluateAnalysisRun. */
  async evaluateHypothesis(input: EvaluateHypothesisInput): Promise<HypothesisEvaluationResult> {
    const clock = input.clock ?? systemClock;
    const { hypothesis, marketStateAtCreation, createdAt, timeSeriesProvider } = input;
    const window = hypothesis.statement.predictionWindow;
    const dueAt = evaluationDueAt(createdAt, window);
    const cond = hypothesis.statement.invalidationCondition;

    if (clock.now() < dueAt.getTime()) {
      const basis: HypothesisEvaluationBasis = {
        source: "window-not-closed",
        ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
        evaluationWindow: { candles: window.candles, timeframe: window.timeframe, dueAt: dueAt.toISOString() },
        detail: `Prediction window has not closed yet. Due at ${dueAt.toISOString()}, now is ${new Date(clock.now()).toISOString()}.`,
      };
      return { status: "pending", actualPriceMovePct: null, evaluationBasis: JSON.stringify(basis) };
    }

    // Creation-time reference: read from the STORED snapshot, never
    // recalculated - the non-negotiable rule this file exists to enforce.
    const creationPrice = marketStateAtCreation.snapshot.price;

    const outputSize = EVALUATION_LOOKBACK_BUFFER_CANDLES + window.candles + 10;
    let candles: Candle[];
    try {
      candles = await timeSeriesProvider.getTimeSeries({
        symbol: hypothesis.symbol,
        interval: PROVIDER_INTERVAL[window.timeframe],
        outputSize,
      });
    } catch (cause) {
      const basis: HypothesisEvaluationBasis = {
        source: "provider-unavailable",
        creationPrice,
        ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
        detail: `The market data provider threw while fetching historical candles for evaluation: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
      return { status: "inconclusive", actualPriceMovePct: null, evaluationBasis: JSON.stringify(basis) };
    }

    if (candles.length === 0) {
      const basis: HypothesisEvaluationBasis = {
        source: "provider-unavailable",
        creationPrice,
        ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
        detail: "The provider returned zero candles for the requested symbol/interval.",
      };
      return { status: "inconclusive", actualPriceMovePct: null, evaluationBasis: JSON.stringify(basis) };
    }

    const evalIdx = candles.findIndex((c) => new Date(c.datetime).getTime() >= dueAt.getTime());
    const creationIdx = candles.findIndex((c) => new Date(c.datetime).getTime() >= new Date(createdAt).getTime());

    if (evalIdx === -1 || creationIdx === -1) {
      const basis: HypothesisEvaluationBasis = {
        source: "insufficient-historical-data",
        creationPrice,
        ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
        evaluationWindow: { candles: window.candles, timeframe: window.timeframe, dueAt: dueAt.toISOString() },
        detail: `The fetched candle series (oldest: ${candles[0].datetime}, latest: ${candles[candles.length - 1].datetime}) does not cover the required range (creation: ${createdAt}, evaluation boundary: ${dueAt.toISOString()}). The current market-data provider only returns the latest N candles as of now, not an arbitrary historical range - see docs/market-data-layer.md.`,
      };
      return { status: "inconclusive", actualPriceMovePct: null, evaluationBasis: JSON.stringify(basis) };
    }

    let invalidationObserved: boolean;
    const evaluationPrice = candles[evalIdx].close;

    if (cond.comparator === "crosses-below" || cond.comparator === "crosses-above") {
      // Scan every real candle within [creation, evaluation boundary] -
      // an intra-window breach counts even if price recovered by the
      // boundary candle itself.
      const windowCandles = candles.slice(creationIdx, evalIdx + 1);
      const refValue = Number(cond.referenceValue);
      invalidationObserved =
        cond.comparator === "crosses-below"
          ? windowCandles.some((c) => c.low < refValue)
          : windowCandles.some((c) => c.high > refValue);
    } else {
      // equals/not-equals: reconstruct a real MarketState AT the
      // evaluation boundary (never today) by feeding the existing,
      // unmodified MarketStateService real historical candles ending
      // there.
      const lookbackStart = Math.max(0, evalIdx - EVALUATION_LOOKBACK_BUFFER_CANDLES + 1);
      const historicalCandles = candles.slice(lookbackStart, evalIdx + 1);
      const historicalSnapshot: MarketSnapshot = {
        ...marketStateAtCreation.snapshot,
        price: evaluationPrice,
        timestamp: candles[evalIdx].datetime,
        retrievedAt: candles[evalIdx].datetime,
      };
      const evalMarketState = this.marketStateSvc.assemble({
        symbol: hypothesis.symbol,
        timeframe: window.timeframe,
        snapshot: historicalSnapshot,
        candles: historicalCandles,
      });
      const actual = readField(evalMarketState, cond.field);
      invalidationObserved = pointInTimeBreach(actual, cond);
    }

    const actualPriceMovePct = ((evaluationPrice - creationPrice) / creationPrice) * 100;
    const status: IntelligenceAnalysisOutcomeStatus = invalidationObserved ? "invalidated" : "validated";
    const basis: HypothesisEvaluationBasis = {
      source: "historical-candle",
      creationPrice,
      evaluationPrice,
      evaluationWindow: { candles: window.candles, timeframe: window.timeframe, dueAt: dueAt.toISOString() },
      invalidationObserved,
      ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
      detail: `Evaluated against real historical candles from ${candles[creationIdx].datetime} through ${candles[evalIdx].datetime}. ${cond.description}`,
    };
    return { status, actualPriceMovePct, evaluationBasis: JSON.stringify(basis) };
  }

  /** Evaluates every hypothesis in a run's stored HypothesisSnapshot, appending one new IntelligenceAnalysisOutcome row per hypothesis - never updating an existing one. */
  async evaluateAnalysisRun(
    analysisRunId: string,
    userId: string,
    deps: { timeSeriesProvider: TimeSeriesProvider; clock?: Clock },
  ): Promise<IntelligenceAnalysisOutcome[]> {
    const run = await this.runs.getAnalysisRun(analysisRunId, userId);
    if (!run) {
      throw new Error(`IntelligenceAnalysisRun ${analysisRunId} not found for this user`);
    }

    if (!run.hypothesisSnapshot) {
      const basis: HypothesisEvaluationBasis = {
        source: "no-hypothesis-snapshot",
        ruleVersion: HYPOTHESIS_OUTCOME_EVALUATOR_RULE_VERSION,
        detail: "This run has no hypothesisSnapshot (created before D2.5.4, or captured with no real hypothesis) - nothing for this evaluator to evaluate.",
      };
      const outcome = await this.outcomes.createOutcome({
        analysisRunId: run.id,
        hypothesisId: null,
        hypothesisType: null,
        regimeType: null,
        status: "inconclusive",
        evaluatedAt: new Date((deps.clock ?? systemClock).now()).toISOString(),
        actualPriceMovePct: null,
        actualRegimeAfter: null,
        evaluationBasis: JSON.stringify(basis),
      });
      return [outcome];
    }

    const { marketState, hypotheses } = run.hypothesisSnapshot;
    if (hypotheses.length === 0) return []; // nothing to evaluate; no outcome fabricated

    const results: IntelligenceAnalysisOutcome[] = [];
    for (const hypothesis of hypotheses) {
      const evaluated = await this.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt: run.createdAt,
        timeSeriesProvider: deps.timeSeriesProvider,
        clock: deps.clock,
      });
      const outcome = await this.outcomes.createOutcome({
        analysisRunId: run.id,
        hypothesisId: hypothesis.id,
        hypothesisType: hypothesis.type,
        regimeType: hypothesis.regimeContext.regimeType,
        status: evaluated.status,
        evaluatedAt: evaluated.status === "pending" ? null : new Date((deps.clock ?? systemClock).now()).toISOString(),
        actualPriceMovePct: evaluated.actualPriceMovePct,
        actualRegimeAfter: null, // no Regime Engine re-derivation in the outcome record itself - see architecture doc
        evaluationBasis: evaluated.evaluationBasis,
      });
      results.push(outcome);
    }

    if (results.length > 0 && results.every((o) => o.status !== "pending")) {
      await this.runs.markEvaluated(run.id, userId);
    }
    return results;
  }

  /** Evaluates every run still awaiting evaluation for a user that has a real D2.5.4 hypothesisSnapshot. Runs with no snapshot are left to D2.5.1's own evaluator. */
  async evaluatePendingAnalysisRun(
    userId: string,
    deps: { timeSeriesProvider: TimeSeriesProvider; clock?: Clock },
    limit = 20,
  ): Promise<IntelligenceAnalysisOutcome[]> {
    const pending = await this.runs.listPendingEvaluationRuns(userId, limit);
    const relevant = pending.filter((r) => r.hypothesisSnapshot !== null);
    const all: IntelligenceAnalysisOutcome[] = [];
    for (const run of relevant) {
      all.push(...(await this.evaluateAnalysisRun(run.id, userId, deps)));
    }
    return all;
  }
}
