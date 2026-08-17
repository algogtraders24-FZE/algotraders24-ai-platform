// types/research/historical-microstructure-research.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. RESEARCH
// ONLY - nothing in this file is consumed by any production intelligence
// path. This is a new, additive, standalone contract for answering one
// question: does D2.8.11's real MicrostructureEvidenceAssessment correlate
// with real subsequent market movement? It never redefines
// MicrostructureEvidenceAssessment itself (imported, not duplicated) and
// never introduces a BUY/SELL trading signal - `hypothesisDirection` here
// is the same non-tradeable directional READ D2.8.11 already uses.
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { HypothesisType } from "@/types/intelligence-hypothesis";
import type { RegimeType } from "@/types/intelligence-regime";
import type { MarketStateVolatilityBand } from "@/types/intelligence-market-state";
import type { MicrostructureSnapshot } from "@/types/microstructure";
import type { MicrostructureEvidenceAssessment, MicrostructureEvidenceStatus } from "@/types/microstructure-evidence-assessment";

export const HISTORICAL_MICROSTRUCTURE_RESEARCH_VERSION = "1.0.0";

/**
 * Phase 1 data-availability classification - see docs/architecture/
 * D2.8.14-historical-microstructure-validation-spec.md §1 for the full
 * per-source table this label is assigned from.
 */
export type DataSourceClassification = "A" | "B" | "C" | "D" | "E";

export interface DataSourceAuditEntry {
  source: string;
  classification: DataSourceClassification;
  detail: string;
}

/**
 * One real historical microstructure observation: a real, already-persisted
 * AT24 hypothesis (from IntelligenceAnalysisRun.hypothesisSnapshot) joined
 * with a real historical volume-delta-only MicrostructureSnapshot built
 * from real Binance aggTrades ending at (never after) the hypothesis's own
 * creation time. `snapshot.evidence.bidLevels/askLevels` are always
 * "not_supported_by_provider" here - Binance's public REST API has no
 * historical order-book endpoint (Phase 1 finding) - never fabricated from
 * OHLC candles.
 */
export interface HistoricalMicrostructureObservation {
  analysisRunId: string;
  hypothesisId: string;
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  provider: string;
  /** The real IntelligenceAnalysisRun.createdAt - the moment this hypothesis existed, and the upper bound of every trade used to build `snapshot`. */
  observedAt: string;
  hypothesisType: HypothesisType;
  /** Same derivation D2.8.11 already uses (the type's own -bullish/-bearish suffix) - never recomputed differently here. */
  hypothesisDirection: "bullish" | "bearish" | "neutral";
  /** Real, persisted regime context this hypothesis was generated under (Hypothesis.regimeContext.regimeType, D2.5.2/D2.5.3) - never recomputed. */
  regimeType: RegimeType;
  /** Real, persisted MarketState.structure.volatilityBand at creation time, when known. */
  volatilityBand?: MarketStateVolatilityBand;
  /** The real historical price at hypothesis creation (from the persisted MarketState.snapshot.price) - never re-fetched from today's data. */
  creationPrice: number;
  /** The real, volume-delta-only historical snapshot built via the unmodified D2.8.5 buildMicrostructureSnapshot(). */
  snapshot: MicrostructureSnapshot;
  /** The real, unmodified D2.8.11 assessMicrostructureEvidence() output - never reimplemented. */
  evidence: MicrostructureEvidenceAssessment;
}

export type DirectionalOutcome = "positive" | "negative" | "inconclusive";

/**
 * Forward-looking metrics for one fixed candle window, computed only from
 * REAL historical candles strictly after `observedAt` - never using
 * information that postdates the observation being evaluated as leakage
 * into an earlier observation (see the leakage audit).
 */
export interface ForwardOutcomeMetrics {
  windowCandles: number;
  evaluationTimestamp: string;
  evaluationPrice: number;
  /** (evaluationPrice - creationPrice) / creationPrice, signed - never direction-adjusted here (that happens in outcome classification). */
  forwardReturnPct: number;
  /** Maximum favorable excursion in the hypothesis's own direction, as a %, across every real candle in the window. Only ever computed for a directional (bullish/bearish) hypothesis - see ForwardOutcomeUnavailableReason for the non-directional case. */
  maximumFavorableExcursionPct: number;
  /** Maximum adverse excursion against the hypothesis's own direction, as a %, across every real candle in the window. */
  maximumAdverseExcursionPct: number;
  /** Direction-aware classification against the deterministic neutral band - see OutcomeDefinition. */
  directionalOutcome: DirectionalOutcome;
}

/** Reasons a forward outcome could not be computed - always reported, never silently dropped. */
export type ForwardOutcomeUnavailableReason = "window-not-covered-by-available-candles" | "provider-unavailable" | "non-directional-hypothesis-no-directional-outcome";

export interface EvaluatedObservation extends HistoricalMicrostructureObservation {
  /** Keyed by window size (1/3/5/10). Undefined entries are honestly reported via `unavailableReasons`, never silently omitted. */
  outcomes: Partial<Record<number, ForwardOutcomeMetrics>>;
  unavailableReasons: Partial<Record<number, ForwardOutcomeUnavailableReason>>;
}

/**
 * The deterministic neutral band this research reuses/documents - see
 * docs/architecture/D2.8.14-historical-microstructure-validation-spec.md
 * §5. NEVER tuned against the same dataset being evaluated (Phase 5's own
 * explicit prohibition) - fixed before any group statistic is computed.
 */
export const OUTCOME_NEUTRAL_BAND_PCT = 0.15;

export interface GroupStatistics {
  group: MicrostructureEvidenceStatus;
  windowCandles: number;
  sampleCount: number;
  winCount: number;
  lossCount: number;
  inconclusiveCount: number;
  winRate?: number;
  lossRate?: number;
  inconclusiveRate?: number;
  avgForwardReturnPct?: number;
  medianForwardReturnPct?: number;
  avgMFEPct?: number;
  medianMFEPct?: number;
  avgMAEPct?: number;
  medianMAEPct?: number;
}

/**
 * Minimum RESOLVED (win+loss, inconclusive excluded from the denominator -
 * same documented convention historical-validation.service.ts already
 * uses, D2.5.4) observations required per group before ANY statistic beyond
 * sampleCount is reported. Reused verbatim from HistoricalValidationService
 * (services/intelligence/memory/historical-validation.service.ts,
 * MIN_HISTORICAL_VALIDATION_SAMPLE = 30) - never a second, competing
 * threshold invented for this sprint.
 */
export const MIN_GROUP_SAMPLE = 30;

export interface GroupComparison {
  groupA: MicrostructureEvidenceStatus;
  groupB: MicrostructureEvidenceStatus;
  windowCandles: number;
  sampleSizeA: number;
  sampleSizeB: number;
  status: "COMPARED" | "INSUFFICIENT_SAMPLE";
  meanDifferencePct?: number;
  medianDifferencePct?: number;
  /** Cohen's d over forward return, using pooled standard deviation. */
  effectSize?: number;
  /** Normal-approximation 95% CI on the mean difference. */
  confidenceInterval95?: [number, number];
  /** Percentile bootstrap 95% CI on the mean difference, 2000 resamples, deterministic seeded RNG. */
  bootstrapCI95?: [number, number];
  /** True only when the 95% CI (bootstrap) excludes zero - never declared from win-rate alone (Phase 7's own explicit rule). */
  significant?: boolean;
}

export interface LeakageFinding {
  type:
    | "future-timestamp"
    | "look-ahead-bias"
    | "future-candle-usage"
    | "duplicate-observation"
    | "duplicate-hypothesis-id"
    | "duplicate-microstructure-snapshot"
    | "same-event-reuse"
    | "provider-mixing"
    | "timezone-mismatch"
    | "stale-snapshot-reuse";
  description: string;
  affectedIds: string[];
}

export interface RegimeBreakdownEntry {
  segment: string;
  segmentValue: string;
  windowCandles: number;
  groups: GroupStatistics[];
}

export interface ChronologicalSplitResult {
  status: "SPLIT" | "VALIDATION_NOT_READY";
  trainCount: number;
  testCount: number;
  splitTimestamp?: string;
  detail: string;
}

export type ResearchFinalClassification =
  | "EDGE_SUPPORTED"
  | "EDGE_NOT_SUPPORTED"
  | "INSUFFICIENT_SAMPLE"
  | "VALIDATION_NOT_READY"
  | "DATA_UNAVAILABLE"
  | "REGIME_DEPENDENT";

export interface HistoricalMicrostructureValidationResult {
  generatedAt: string;
  version: string;
  dataSourceAudit: DataSourceAuditEntry[];
  symbols: MarketSymbol[];
  dateRange: { earliest: string; latest: string } | undefined;
  observationsConsidered: number;
  observationsUsable: number;
  observationsRejected: number;
  rejectionReasons: Record<string, number>;
  duplicatesRemoved: number;
  leakageFindings: LeakageFinding[];
  groupCounts: Record<MicrostructureEvidenceStatus, number>;
  groupStatisticsByWindow: Record<number, GroupStatistics[]>;
  comparisons: GroupComparison[];
  regimeBreakdown: RegimeBreakdownEntry[];
  chronologicalSplit: ChronologicalSplitResult;
  finalClassification: ResearchFinalClassification;
  classificationRationale: string;
}
