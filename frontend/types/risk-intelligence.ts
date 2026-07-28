// types/risk-intelligence.ts
// Sprint 15D.6 - Risk Intelligence Engine domain types. Standalone,
// consumes Sprint 15D.5's ReasoningResult unmodified. Named RiskProfile
// (not RiskAssessment) to avoid colliding with the existing trading-signal
// RiskAssessment in types/risk.ts (signalId, maxDrawdownPercent,
// riskRewardRatio - an unrelated mock concept) - the same naming
// discipline Sprint 15D.5 established for RiskDriver.
import type { MarketSymbol } from "./market";
import type { EvidenceItem } from "./evidence";
import type { RiskLevel } from "./risk";

export type RiskCategory =
  | "market"
  | "event"
  | "liquidity"
  | "volatility"
  | "execution"
  | "evidence-conflict"
  | "data-quality"
  | "uncertainty";

export interface RiskCategoryScore {
  category: RiskCategory;
  level: RiskLevel;
  /** Deterministic, human-readable explanation - never empty. A "medium" from missing evidence says so explicitly; it is never presented as if it were computed from real signals. */
  rationale: string[];
  /** The evidence this score was derived from. Empty when a category has no evidence source in this system at all (e.g. liquidity, execution) - never backfilled. */
  basis: EvidenceItem[];
}

export interface RiskProfile {
  symbol: MarketSymbol;
  /** Exactly one entry per RiskCategory, in a fixed order. */
  categories: RiskCategoryScore[];
  /** The worst (highest) level among all categories - a risk profile is never allowed to hide a high-risk category behind an average. */
  overallLevel: RiskLevel;
  generatedAt: string;
}
