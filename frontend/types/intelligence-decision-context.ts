// types/intelligence-decision-context.ts
// Sprint D2.6.1 - Trader Intelligence Decision Context. See
// docs/architecture/D2.6.1-trader-decision-context-spec.md for the full
// contract, state-classification rules, and the permanent product
// principle this type exists to enforce.
//
// PERMANENT PRODUCT PRINCIPLE (repeat this before touching this file):
// "AT24 does not tell the trader what to believe. It shows what the
// available evidence supports, what contradicts it, what could
// invalidate it, and how complete the intelligence is." This is a
// decision-intelligence system, never a signal generator. Nothing in
// this file may contain a BUY/SELL instruction, a target price, a stop
// loss, a win-rate claim, or a probability of profit/direction - see
// the spec's "Prohibited outputs" section for the exact, permanent list.
//
// Every field here is derived ONLY from the existing, real
// IntelligenceEnvelope (D2.5.1-D2.5.5) - never LLM-generated, never a
// new indicator/risk/regime computation. A Hypothesis's `claim` string
// is D2.5.3's own deterministic template text, reused verbatim, never
// rewritten here.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { MarketStateVolatilityBand, MarketStateRecentRange } from "./intelligence-market-state";
import type { DataConfidence } from "./technical-context";
import type { RegimeType } from "./intelligence-regime";
import type {
  HypothesisType,
  PredictionWindow,
  InvalidationCondition,
  InvalidationComparator,
} from "./intelligence-hypothesis";
import type { EvidenceItem, EvidenceConflict, EvidenceType } from "./evidence";
import type { RiskCategory, RiskCategoryScore } from "./risk-intelligence";
import type { RiskLevel } from "./risk";
import type { IntelligenceScore } from "./intelligence-score";
import type { MicrostructureEvidenceAssessment } from "./microstructure-evidence-assessment";

/**
 * Deterministic, real-data-only summary of the current MarketState - no
 * new indicator math, every field a direct passthrough. `undefined`
 * fields mean the real value genuinely wasn't computable (insufficient
 * candles), matching MarketState's own honesty contract exactly.
 */
export interface DecisionCurrentState {
  price: number;
  trendDirection?: "up" | "down" | "sideways";
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  rsi14?: number;
  atr14?: number;
  volatilityBand?: MarketStateVolatilityBand;
  recentRange?: MarketStateRecentRange;
  breakoutSignal?: "breakout" | "breakdown";
  dataQuality: DataConfidence;
  /** Deterministic, human-readable statements citing the real fields above - never empty. */
  basis: string[];
}

/** Direct passthrough of Regime (D2.5.2) - never a second classification. */
export interface DecisionRegimeContext {
  regimeType: RegimeType;
  confidence: number;
  basis: string[];
  previousRegime?: RegimeType;
  transitionDetectedAt?: string;
  /** `false` only when regimeType === "insufficient-data" - the market cannot currently be characterized reliably. */
  isReliable: boolean;
}

/**
 * A hypothesis restated as structured decision context, never as a
 * signal or probability. `claim` is D2.5.3's own deterministic template
 * string, reused verbatim - this file never generates new prose.
 */
export interface DecisionHypothesisContext {
  hypothesisId: string;
  type: HypothesisType;
  claim: string;
  predictionWindow: PredictionWindow;
  invalidationCondition: InvalidationCondition;
  requiredEvidence: EvidenceType[];
  supportingEvidence: EvidenceItem[];
  opposingEvidence: EvidenceItem[];
}

export interface DecisionRiskContext {
  overallLevel?: RiskLevel;
  /** Exactly RiskProfile.categories, unmodified - see D2.5.5's own riskAwareness component for the same reuse discipline. */
  categories: RiskCategoryScore[];
  categoriesWithEvidence: RiskCategory[];
  /** Categories with RiskEngine's own honest "unmeasured" default (e.g. liquidity/execution) - never presented as a failure. */
  categoriesUnavailable: RiskCategory[];
  basis: string[];
  dataAvailable: boolean;
}

export type DecisionHistoricalContextStatus = "available" | "insufficient-sample" | "unavailable";

/** Direct passthrough of D2.5.4's HistoricalValidation - never a recomputation. */
export interface DecisionHistoricalContext {
  status: DecisionHistoricalContextStatus;
  sampleSize?: number;
  validatedCount?: number;
  invalidatedCount?: number;
  inconclusiveCount?: number;
  /** Only present when status === "available" (D2.5.4's own minimum-sample gate was satisfied). Never fabricated below threshold. */
  validatedRate?: number;
  minSampleSize?: number;
  basis: string[];
}

/** One hypothesis's falsification condition, flattened for direct trader-facing display: "what would prove this wrong?" */
export interface DecisionInvalidationItem {
  hypothesisId: string;
  hypothesisType: HypothesisType;
  description: string;
  field: string;
  comparator: InvalidationComparator;
  referenceValue: string | number;
  basis: string[];
}

export type MonitoringItemCategory =
  | "trend"
  | "recent-range"
  | "volatility"
  | "evidence-conflict"
  | "hypothesis-invalidation"
  | "historical-sample"
  | "data-quality";

/** A deterministic "what matters next" item - never an alert, never scheduled, never notified. */
export interface DecisionMonitoringItem {
  category: MonitoringItemCategory;
  description: string;
  basis: string[];
}

/**
 * Three distinct kinds of "we don't have this" - never collapsed into
 * one generic "missing" label:
 * - "unsupported": this platform has no data source for this at all
 *   (permanent, e.g. liquidity zones, volume delta, execution risk).
 * - "unavailable": the input simply wasn't supplied to this analysis
 *   (e.g. no EvidenceBundle/RiskProfile was passed in).
 * - "insufficient-data": the input was attempted but real data was too
 *   thin to compute it (e.g. too few candles for a recent range).
 */
export type MissingInformationKind = "unsupported" | "unavailable" | "insufficient-data";

export interface DecisionMissingInformationItem {
  kind: MissingInformationKind;
  description: string;
  /** Dot-path-style pointer into this DecisionContext, e.g. "riskContext.liquidity", "historicalContext". */
  affectedArea: string;
}

/**
 * A deterministic classification of the QUALITY of the decision context
 * itself - never market direction, never a trade signal. See the spec's
 * §5 for the exact, versioned, documented rules.
 */
export type DecisionState = "well-supported" | "partially-supported" | "conflicted" | "insufficient-intelligence";

export interface IntelligenceDecisionContext {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  state: DecisionState;

  currentState: DecisionCurrentState;
  regimeContext: DecisionRegimeContext;

  /** May legitimately be empty - 3 of 10 regime types never generate a hypothesis (D2.5.3). Never fabricated to avoid an empty array. */
  primaryHypotheses: DecisionHypothesisContext[];
  /** Deduplicated union of every primaryHypotheses[].supportingEvidence - never a separate detection pass. */
  supportingEvidence: EvidenceItem[];
  /** Deduplicated union of every primaryHypotheses[].opposingEvidence. */
  opposingEvidence: EvidenceItem[];
  /** Real, already-detected EvidenceConflicts with resolution === "unresolved" - never auto-resolved here. */
  unresolvedConflicts: EvidenceConflict[];

  riskContext: DecisionRiskContext;
  historicalContext: DecisionHistoricalContext;

  /**
   * Sprint D2.8.11 - a deterministic comparison of real, provider-attributed
   * microstructure evidence (D2.8.5-D2.8.10, reused verbatim) against the
   * primary hypothesis's direction. Present only when a microstructure
   * snapshot was supplied to DecisionContextService.build() (opt-in,
   * mirroring D2.8.7/D2.8.9's own additive posture) - absent (never a
   * fabricated "insufficient_evidence" placeholder) when no snapshot was
   * ever attempted. This is additional EVIDENCE ABOUT the hypothesis, never
   * a replacement for it and never a numeric input to intelligenceScore
   * below (D2.5.5's formula/weights are unmodified by this sprint).
   */
  microstructureEvidence?: MicrostructureEvidenceAssessment;

  /** D2.5.5's IntelligenceScore, reused verbatim - never recalculated, never reinterpreted as trade probability. */
  intelligenceScore: IntelligenceScore;

  /** Flattened across every hypothesis - "what would make this current view wrong?" */
  invalidationConditions: DecisionInvalidationItem[];
  monitoringItems: DecisionMonitoringItem[];
  missingInformation: DecisionMissingInformationItem[];

  /** Top-level rollup explaining how `state` was reached - never just the label with no reasoning. */
  summaryBasis: string[];

  generatedAt: string;
  pipelineVersion: string;
  intelligenceEngineVersion: string;
}
