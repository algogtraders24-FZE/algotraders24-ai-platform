// types/intelligence-hypothesis.ts
// Sprint D2.5.3 - Deterministic Hypothesis Engine (Intelligence Engine V2,
// phase 3). A Hypothesis is a falsifiable RESEARCH CLAIM, never a trade
// instruction. It never contains a BUY/SELL/execution/position-sizing
// field, and `confidence` (see below) is never a probability of profit -
// see docs/architecture/D2.5.3-hypothesis-engine-spec.md §1-2 for the full
// philosophy and the signal-vs-hypothesis boundary this contract enforces.
//
// Deliberately a SMALL, closed set of types (9 named, only 7 actually
// generated - see hypothesis.service.ts's header for why
// reversal-candidate-bullish/bearish are declared but never produced in
// D2.5.3). Every type has exactly one deterministic generation rule; no
// type is added "for completeness."
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { RegimeType } from "./intelligence-regime";
import type { EvidenceItem, EvidenceType } from "./evidence";

export type HypothesisType =
  | "trend-continuation-bullish"
  | "trend-continuation-bearish"
  | "breakout-confirmation-bullish"
  | "breakout-confirmation-bearish"
  | "reversal-candidate-bullish" // declared, never generated in D2.5.3 - see hypothesis.service.ts header
  | "reversal-candidate-bearish" // declared, never generated in D2.5.3 - see hypothesis.service.ts header
  | "range-continuation"
  | "volatility-expansion"
  | "volatility-contraction";

/** Candle-based, never vague ("in the near future" is not a prediction window). */
export interface PredictionWindow {
  candles: number;
  timeframe: SignalTimeframe;
}

export type InvalidationComparator =
  | "equals"
  | "not-equals"
  /** The field's real future value drops below `referenceValue` (used for a price crossing back below a breakout boundary). */
  | "crosses-below"
  /** The field's real future value rises above `referenceValue` (used for a price crossing back above a breakdown boundary). */
  | "crosses-above";

/**
 * A structured, machine-checkable falsification condition - not just a
 * human-readable sentence. `field` is a dot-path into a future MarketState
 * (e.g. "structure.trend.direction", "snapshot.price") that a later
 * evaluator must recheck; `referenceValue` is the REAL value recorded at
 * hypothesis-creation time, never recomputed differently later. This is
 * the property the sprint calls "the most important": a future evaluator
 * must be able to determine validated/invalidated/inconclusive from actual
 * market data using this condition alone, without re-deriving it.
 */
export interface InvalidationCondition {
  description: string;
  field: string;
  comparator: InvalidationComparator;
  referenceValue: string | number;
}

export interface HypothesisStatement {
  /** Deterministic, template-filled from real MarketState/Regime fields - never LLM-generated prose. */
  claim: string;
  predictionWindow: PredictionWindow;
  invalidationCondition: InvalidationCondition;
}

export type HypothesisStatus = "active" | "invalidated" | "expired" | "pending";

export interface Hypothesis {
  id: string;
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  /** The real Regime that produced this hypothesis - a narrow slice, not the full object, so this doesn't silently grow stale if Regime's shape changes. */
  regimeContext: { regimeType: RegimeType; confidence: number; generatedAt: string };
  type: HypothesisType;
  statement: HypothesisStatement;
  /** Declares what evidence TYPES this hypothesis rule depends on (types/evidence.ts#EvidenceType) - reused, not duplicated. */
  requiredEvidence: EvidenceType[];
  /** Real EvidenceItems backing this hypothesis, built from the real MarketState fields that satisfied its generation rule. Never empty for a generated hypothesis. */
  supportingEvidence: EvidenceItem[];
  /**
   * Real EvidenceItems that conflict with this hypothesis, sourced only
   * from an EvidenceBundle's own already-detected EvidenceConflicts for
   * this symbol (never independently interpreted from free text - see
   * hypothesis.service.ts). Empty array means "genuinely none found", not
   * "not checked".
   */
  opposingEvidence: EvidenceItem[];
  /**
   * Always "active" when produced by HypothesisService in D2.5.3 - this
   * engine never marks a hypothesis "invalidated"/"expired" itself
   * (that's a future evaluator's job) and never has a reason to withhold
   * activation for a hypothesis it already decided to generate. "pending"
   * is reserved for a future sprint's use.
   */
  status: HypothesisStatus;
  /** Identifies the deterministic engine, e.g. "deterministic-hypothesis-engine-v2" - NEVER "gemini"/"ai"/"llm". The LLM is not the source of the hypothesis. */
  generatedBy: string;
  generatedAt: string;
  /** Same Intelligence Engine V2 version as MarketState/Regime (e.g. "2.0.0") - NOT MARKET_INTELLIGENCE_PIPELINE_VERSION. */
  pipelineVersion: string;
}
