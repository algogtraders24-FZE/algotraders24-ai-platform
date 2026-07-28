// services/ai/risk/risk-engine.service.ts
// Sprint 15D.6 - Risk Intelligence Engine. Standalone, deterministic, no
// AI calls, no Gemini/prompt involvement: consumes a Sprint 15D.5
// ReasoningResult (unmodified) and produces a RiskProfile using only
// counting, filtering, and lookups against what 15D.5 already computed.
// No Date.now(), no randomness - every timestamp is a caller-supplied
// parameter, matching the convention every prior 15D service established.
//
// Honesty policy for categories this system has no evidence source for
// (liquidity, execution): they are always reported as "medium" - a
// genuinely neutral "cannot be confirmed or ruled out" stance - and never
// defaulted to "low", which would be a fabricated reassurance. Every
// category's rationale says explicitly whether it was computed from real
// evidence or is an honest "unmeasured" default.
import type { EvidenceItem } from "@/types/evidence";
import type { ReasoningResult } from "@/types/reasoning";
import type { RiskCategoryScore, RiskProfile } from "@/types/risk-intelligence";
import type { RiskLevel } from "@/types/risk";

const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export class RiskEngineService {
  /**
   * Produces a deterministic RiskProfile from a ReasoningResult.
   * `generatedAt` defaults to the reasoning result's own timestamp but can
   * be overridden for determinism in tests.
   */
  assess(reasoning: ReasoningResult, generatedAt: string = reasoning.generatedAt): RiskProfile {
    const categories: RiskCategoryScore[] = [
      this.assessMarketRisk(reasoning),
      this.assessEventRisk(reasoning),
      this.assessLiquidityRisk(),
      this.assessVolatilityRisk(reasoning),
      this.assessExecutionRisk(),
      this.assessEvidenceConflictRisk(reasoning),
      this.assessDataQualityRisk(reasoning),
      this.assessUncertaintyRisk(reasoning),
    ];

    return {
      symbol: reasoning.symbol,
      categories,
      overallLevel: this.worstLevel(categories.map((c) => c.level)),
      generatedAt,
    };
  }

  private allItems(reasoning: ReasoningResult): EvidenceItem[] {
    return [...reasoning.supportingEvidence, ...reasoning.opposingEvidence, ...reasoning.unresolvedItems];
  }

  private worstLevel(levels: readonly RiskLevel[]): RiskLevel {
    return levels.reduce<RiskLevel>((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), "low");
  }

  // Directional/price risk: grounded in `price`-type evidence and any
  // detected disagreement among it. No price evidence at all -> medium
  // (unknown), never a fabricated "low".
  private assessMarketRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const priceEvidence = this.allItems(reasoning).filter((item) => item.type === "price");
    const priceConflicts = reasoning.conflicts.filter((c) => c.type === "price");

    if (priceConflicts.length > 0) {
      return {
        category: "market",
        level: "high",
        rationale: [`${priceConflicts.length} price evidence conflict(s) detected - sources disagree on price`],
        basis: priceEvidence,
      };
    }
    if (priceEvidence.length > 0) {
      return {
        category: "market",
        level: "low",
        rationale: [`${priceEvidence.length} price evidence item(s), no disagreement detected`],
        basis: priceEvidence,
      };
    }
    return {
      category: "market",
      level: "medium",
      rationale: ["No price evidence available - market risk cannot be confirmed or ruled out"],
      basis: [],
    };
  }

  // Macro/news event risk, same pattern as market risk applied to a
  // different evidence-type set.
  private assessEventRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const eventEvidence = this.allItems(reasoning).filter((item) => item.type === "macro" || item.type === "news");
    const eventConflicts = reasoning.conflicts.filter((c) => c.type === "macro" || c.type === "news");

    if (eventConflicts.length > 0) {
      return {
        category: "event",
        level: "high",
        rationale: [`${eventConflicts.length} macro/news evidence conflict(s) detected`],
        basis: eventEvidence,
      };
    }
    if (eventEvidence.length > 0) {
      return {
        category: "event",
        level: "low",
        rationale: [`${eventEvidence.length} macro/news evidence item(s), no disagreement detected`],
        basis: eventEvidence,
      };
    }
    return {
      category: "event",
      level: "medium",
      rationale: ["No macro/news evidence available - event risk cannot be confirmed or ruled out"],
      basis: [],
    };
  }

  // No EvidenceType in this system represents liquidity (order book depth,
  // spread) at all - always an honest "unmeasured" medium, never guessed
  // from unrelated evidence.
  private assessLiquidityRisk(): RiskCategoryScore {
    return {
      category: "liquidity",
      level: "medium",
      rationale: ["No evidence source for liquidity exists in this system - defaulting to medium (unmeasured), never assumed low"],
      basis: [],
    };
  }

  // No dedicated volatility evidence exists either (AlphaVantageProvider
  // never populates it); `technical`-type disagreement is the closest
  // available signal that interpretation is unstable, so it elevates this
  // category - otherwise it stays an honest "unmeasured" medium.
  private assessVolatilityRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const technicalEvidence = this.allItems(reasoning).filter((item) => item.type === "technical");
    const technicalConflicts = reasoning.conflicts.filter((c) => c.type === "technical");

    if (technicalConflicts.length > 0) {
      return {
        category: "volatility",
        level: "high",
        rationale: [`${technicalConflicts.length} technical evidence conflict(s) detected - unstable interpretation`],
        basis: technicalEvidence,
      };
    }
    return {
      category: "volatility",
      level: "medium",
      rationale: ["No dedicated volatility evidence exists in this system - defaulting to medium (unmeasured)"],
      basis: technicalEvidence,
    };
  }

  // This platform deliberately does not integrate broker/execution data
  // (spread, slippage, latency) - separating intelligence from execution
  // is a locked principle since the Sprint 15D.3 architecture review.
  // Execution risk is therefore always unassessed here, by design.
  private assessExecutionRisk(): RiskCategoryScore {
    return {
      category: "execution",
      level: "medium",
      rationale: ["This platform does not integrate broker/execution data by design - execution risk is always unassessed here"],
      basis: [],
    };
  }

  // Directly reflects the same conflicts Sprint 15D.5 already computed -
  // no re-derivation, a faithful count.
  private assessEvidenceConflictRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const count = reasoning.conflicts.length;
    const level: RiskLevel = count === 0 ? "low" : count === 1 ? "medium" : "high";
    return {
      category: "evidence-conflict",
      level,
      rationale: [`${count} unresolved evidence conflict(s)`],
      basis: reasoning.conflicts.flatMap((c) => [c.itemA, c.itemB]),
    };
  }

  // Aggregates Sprint 15D.5's own "data-gap" and "staleness" risk drivers
  // (worse of the two) rather than re-scanning evidence - a genuine
  // consumption of ReasoningResult, not a parallel computation.
  private assessDataQualityRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const dataGap = reasoning.riskDrivers.find((d) => d.factor === "data-gap");
    const staleness = reasoning.riskDrivers.find((d) => d.factor === "staleness");
    const levels = [dataGap?.level, staleness?.level].filter((level): level is RiskLevel => level !== undefined);
    const rationale = [dataGap?.detail, staleness?.detail].filter((detail): detail is string => detail !== undefined);

    return {
      category: "data-quality",
      level: levels.length > 0 ? this.worstLevel(levels) : "medium",
      rationale: rationale.length > 0 ? rationale : ["No data-quality signal available from the reasoning result"],
      basis: [],
    };
  }

  // Directly buckets Sprint 15D.5's own uncertainty score - no
  // re-derivation.
  private assessUncertaintyRisk(reasoning: ReasoningResult): RiskCategoryScore {
    const score = reasoning.uncertainty.score;
    const level: RiskLevel = score >= 67 ? "high" : score >= 34 ? "medium" : "low";
    return {
      category: "uncertainty",
      level,
      rationale: reasoning.uncertainty.reasons.length > 0 ? reasoning.uncertainty.reasons : [`Uncertainty score: ${score}/100`],
      basis: [],
    };
  }
}
