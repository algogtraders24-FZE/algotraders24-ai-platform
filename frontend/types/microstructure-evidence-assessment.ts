// types/microstructure-evidence-assessment.ts
// Sprint D2.8.11 - Microstructure-Aware Decision Intelligence & Evidence
// Fusion. A NEW, small, additive contract - never a second DecisionContext,
// never a second hypothesis engine, never a trading signal. This is a
// deterministic comparison of D2.8.5's real MicrostructureSnapshot against
// the EXISTING active hypothesis (D2.5.3), answering exactly one question:
// "does real venue order-flow evidence CONFIRM, CONTRADICT, or fail to
// materially inform the current hypothesis?" - never "should I buy/sell".
//
// PERMANENT PRODUCT PRINCIPLE (same one types/intelligence-decision-context.ts
// already enforces): this type may never contain a BUY/SELL instruction, a
// target price, a stop loss, or a probability of profit. `status` describes
// a RELATIONSHIP between two pieces of real evidence, not a recommendation.
import type { MarketSymbol } from "./market";
import type { HypothesisType } from "./intelligence-hypothesis";
import type { MicrostructureFreshnessStatus } from "./microstructure";

export const MICROSTRUCTURE_EVIDENCE_ASSESSMENT_VERSION = "1.0.0";

/**
 * - "confirms": real microstructure directional pressure agrees with the active hypothesis's direction.
 * - "contradicts": real microstructure directional pressure opposes it.
 * - "neutral": real, fresh, usable evidence exists, but its net pressure is too small (within the documented neutral band) to call either way.
 * - "insufficient_evidence": no comparison could honestly be made at all - missing/stale/invalid snapshot, no usable signal, no active hypothesis, or a non-directional hypothesis. NEVER collapsed into "neutral" - "we couldn't tell" and "we could tell and it's balanced" are different facts.
 */
export type MicrostructureEvidenceStatus = "confirms" | "contradicts" | "neutral" | "insufficient_evidence";

/** The microstructure-only directional read, independent of any hypothesis - "neutral" here means the raw signal itself was balanced/weak. */
export type MicrostructureDirectionalBalance = "bullish" | "bearish" | "neutral";

/** A documented, versioned V1 heuristic classification of |netPressure| - see microstructure-evidence-assessment.service.ts's own NEUTRAL_PRESSURE_BAND/STRONG_PRESSURE_THRESHOLD constants for the exact, justified boundaries. "none" means no usable signal existed at all (never confused with a real weak reading). */
export type MicrostructureEvidenceStrength = "none" | "weak" | "moderate" | "strong";

export interface MicrostructureEvidenceAssessment {
  status: MicrostructureEvidenceStatus;
  balance: MicrostructureDirectionalBalance;
  /**
   * Normalized magnitudes in [0, 1], derived only from real, "available"
   * relative signals (order-book depth imbalance, aggressor-normalized
   * volume delta) - NEVER present (undefined, not 0) when status is
   * "insufficient_evidence" with no usable signal. A genuinely balanced
   * reading (status "neutral") still carries real, small, non-fabricated
   * values here - the distinction from "insufficient_evidence" is whether
   * a real signal existed, not whether it happened to be small.
   */
  bullishPressure?: number;
  bearishPressure?: number;
  evidenceStrength: MicrostructureEvidenceStrength;

  /** Present only when a real MicrostructureSnapshot was actually evaluated - absent (never guessed) when no snapshot was supplied at all. */
  provider?: string;
  instrument?: MarketSymbol;
  freshness?: MicrostructureFreshnessStatus;
  timestamp?: string;

  /** Present only when a real hypothesis was compared against. */
  hypothesisType?: HypothesisType;
  hypothesisDirection?: "bullish" | "bearish" | "neutral";

  /** Deterministic, human-readable statements citing the real fields/values used - same convention as every other Decision Context basis[] field, never empty. */
  basis: string[];

  generatedAt: string;
  version: string;
}
