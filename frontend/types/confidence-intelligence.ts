// types/confidence-intelligence.ts
// Sprint 15D.7 - Confidence Intelligence Engine domain types. Standalone:
// consumes Sprint 15D.4's EvidenceBundle, Sprint 15D.5's ReasoningResult,
// and Sprint 15D.6's RiskProfile (all unmodified) and produces a
// deterministic ConfidenceProfile.
//
// Naming note: types/reasoning.ts already exports a `ConfidenceFactor`
// union and a `ConfidenceDriver` interface - a narrower, 4-factor concept
// tied specifically to ReasoningResult. This file's 7-category model is a
// distinct, broader concept, so it uses its own names -
// `ConfidenceCategory`/`ConfidenceContribution` - rather than reusing or
// colliding with those, continuing the naming discipline established in
// Sprint 15D.5/15D.6 (RiskDriver vs. types/risk.ts's RiskAssessment;
// RiskProfile vs. the same file's RiskAssessment).
import type { MarketSymbol } from "./market";
import type { EvidenceItem } from "./evidence";

export type ConfidenceCategory =
  | "evidence-quality"
  | "evidence-quantity"
  | "evidence-agreement"
  | "source-diversity"
  | "data-freshness"
  | "coverage-completeness"
  | "unknown-factors";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface ConfidenceCategoryScore {
  category: ConfidenceCategory;
  /** 0-100, higher = more confidence. 0 for a category with no usable evidence - never fabricated as a neutral/default midpoint. */
  score: number;
  /** Deterministic, human-readable explanation - never empty. */
  rationale: string[];
  /** The evidence this score was derived from. Empty when there is genuinely none to point to - never backfilled. */
  basis: EvidenceItem[];
}

/** Restates a category's score as a plain positive/negative signal for the profile's top-level narrative. */
export interface ConfidenceContribution {
  category: ConfidenceCategory;
  detail: string;
  impact: "positive" | "negative";
}

export interface ConfidencePenalty {
  reason: string;
  /** Points subtracted from the category average to reach overallScore. Always > 0 - a "no penalty" case is represented by the entry's absence, never a zero-point entry. */
  points: number;
}

export interface ConfidenceProfile {
  symbol: MarketSymbol;
  /** Exactly one entry per ConfidenceCategory, in a fixed order. */
  categories: ConfidenceCategoryScore[];
  /** One entry per category, in the same order. */
  drivers: ConfidenceContribution[];
  /** Cross-cutting deductions sourced from the Sprint 15D.6 RiskProfile's own overall verdict - never restating a specific risk category already reflected in a category score above, to avoid double-counting the same evidence. */
  penalties: ConfidencePenalty[];
  /** Union of every category's basis, de-duplicated by reference - the concrete evidence this profile is actually grounded in. */
  basis: EvidenceItem[];
  /** Mean of the 7 category scores minus total penalty points, clamped to [0, 100]. */
  overallScore: number;
  overallLevel: ConfidenceLevel;
  generatedAt: string;
}
