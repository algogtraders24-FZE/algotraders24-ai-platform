// types/reasoning.ts
// Sprint 15D.5 - Reasoning Intelligence Engine domain types. Standalone:
// consumes Sprint 15D.4's EvidenceBundle/EvidenceItem/EvidenceConflict
// (unmodified) and produces a deterministic ReasoningResult with no AI
// involvement whatsoever - every field here is computed by counting,
// grouping, and comparing timestamps, never by generating text with a
// model. Deliberately does NOT reuse or extend types/risk.ts's existing
// `RiskAssessment` (that type is a trading-signal concept - signalId,
// maxDrawdownPercent, riskRewardRatio - unrelated to this reasoning
// layer); `RiskDriver` below is a narrower, distinct concept.
import type { MarketSymbol } from "./market";
import type { EvidenceItem, EvidenceConflict, EvidenceType } from "./evidence";
import type { RiskLevel } from "./risk";

/**
 * A statement about what this reasoning pass could NOT verify, derived
 * purely from which EvidenceTypes are absent from the bundle - never a
 * guess about what the missing evidence might say.
 */
export interface Assumption {
  type: EvidenceType;
  statement: string;
}

export type ConfidenceFactor = "evidence-volume" | "coverage" | "conflicts" | "freshness";

export interface ConfidenceDriver {
  factor: ConfidenceFactor;
  detail: string;
  impact: "positive" | "negative";
}

export type RiskFactor = "data-gap" | "conflict" | "staleness";

export interface RiskDriver {
  factor: RiskFactor;
  detail: string;
  level: RiskLevel;
}

export interface Uncertainty {
  /** 0-100, higher = more uncertain. Deterministic function of coverage/conflicts/freshness - never a model's self-reported confidence. */
  score: number;
  /** Deterministic, human-readable reasons behind the score, in a fixed order. */
  reasons: string[];
}

export interface ReasoningResult {
  symbol: MarketSymbol;
  /** Evidence with no unresolved disagreement against it within its own type group. */
  supportingEvidence: EvidenceItem[];
  /** The minority side of a type group where a majority/minority split could be determined. */
  opposingEvidence: EvidenceItem[];
  /** Pass-through of the EvidenceBundle's own conflicts - never re-interpreted. */
  conflicts: EvidenceConflict[];
  /** Items caught in a symmetric/ambiguous disagreement where no majority side could be determined - deliberately left unclassified rather than guessed. */
  unresolvedItems: EvidenceItem[];
  assumptions: Assumption[];
  uncertainty: Uncertainty;
  confidenceDrivers: ConfidenceDriver[];
  riskDrivers: RiskDriver[];
  generatedAt: string;
}
