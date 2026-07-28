// services/ai/confidence/confidence-engine.service.ts
// Sprint 15D.7 - Confidence Intelligence Engine. Standalone, deterministic,
// AI-provider independent: consumes a Sprint 15D.4 EvidenceBundle, a
// Sprint 15D.5 ReasoningResult, and a Sprint 15D.6 RiskProfile (all
// unmodified) and produces a ConfidenceProfile using only counting,
// grouping, and simple date math - no model call, no prompt, no
// randomness, no Date.now() (every timestamp is a caller-supplied
// parameter, matching every prior 15D engine).
//
// Never-fabricate-confidence policy: a category with no usable evidence
// scores 0 (an honest "we cannot claim confidence here"), never a
// reassuring default midpoint. This is a deliberate departure from the
// Sprint 15D.6 RiskEngineService convention (unmeasurable risk -> neutral
// "medium"): confidence and risk ask different questions here - "how sure
// are we?" has a true floor of zero when there is nothing to be sure
// about, whereas "how risky is this?" has no such natural floor for a
// dimension the system simply cannot observe at all.
import type { EvidenceBundle, EvidenceItem, EvidenceType } from "@/types/evidence";
import type { ReasoningResult } from "@/types/reasoning";
import type { RiskProfile } from "@/types/risk-intelligence";
import type {
  ConfidenceCategoryScore,
  ConfidenceContribution,
  ConfidenceLevel,
  ConfidencePenalty,
  ConfidenceProfile,
} from "@/types/confidence-intelligence";

// Mirrors the EvidenceType union in types/evidence.ts. Kept as an explicit
// list (rather than derived at runtime from a TS type, which isn't
// possible) so "which types are missing" is computable - same convention
// ReasoningEngineService already established.
const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = [
  "price",
  "technical",
  "news",
  "macro",
  "sentiment",
  "historical-pattern",
  "cross-asset",
  "provider-meta",
];

const FRESHNESS_WARNING_MINUTES = 15;
const FRESHNESS_STALE_MINUTES = 60;
const SOURCE_DIVERSITY_TARGET = 3;
const EVIDENCE_QUANTITY_TARGET = ALL_EVIDENCE_TYPES.length;

export class ConfidenceEngineService {
  /**
   * Produces a deterministic ConfidenceProfile from an EvidenceBundle, the
   * ReasoningResult derived from it, and the RiskProfile derived from that
   * reasoning. `generatedAt` defaults to the bundle's own timestamp but can
   * be overridden by a caller with its own clock, for determinism in
   * tests - this method itself never reads the system clock.
   */
  assess(
    bundle: EvidenceBundle,
    reasoning: ReasoningResult,
    riskProfile: RiskProfile,
    generatedAt: string = bundle.generatedAt,
  ): ConfidenceProfile {
    const categories: ConfidenceCategoryScore[] = [
      this.assessEvidenceQuality(bundle),
      this.assessEvidenceQuantity(bundle),
      this.assessEvidenceAgreement(reasoning),
      this.assessSourceDiversity(bundle),
      this.assessDataFreshness(bundle, generatedAt),
      this.assessCoverageCompleteness(bundle),
      this.assessUnknownFactors(reasoning),
    ];

    const drivers = this.buildDrivers(categories);
    const penalties = this.buildPenalties(riskProfile);
    const basis = this.mergeBasis(categories);
    const overallScore = this.computeOverallScore(categories, penalties);

    return {
      symbol: bundle.symbol,
      categories,
      drivers,
      penalties,
      basis,
      overallScore,
      overallLevel: this.levelFor(overallScore),
      generatedAt,
    };
  }

  private levelFor(score: number): ConfidenceLevel {
    if (score >= 67) return "high";
    if (score >= 34) return "medium";
    return "low";
  }

  // Proportion of items backed by a numeric magnitude (objective) rather
  // than prose alone - a deterministic proxy for evidence "quality". No
  // evidence at all -> 0, never a fabricated default.
  private assessEvidenceQuality(bundle: EvidenceBundle): ConfidenceCategoryScore {
    const total = bundle.items.length;
    if (total === 0) {
      return {
        category: "evidence-quality",
        score: 0,
        rationale: ["No evidence available - quality cannot be assessed"],
        basis: [],
      };
    }
    const quantitative = bundle.items.filter((item) => item.magnitude !== undefined);
    const score = Math.round((100 * quantitative.length) / total);
    return {
      category: "evidence-quality",
      score,
      rationale: [`${quantitative.length} of ${total} evidence item(s) have quantitative (numeric) backing`],
      basis: quantitative,
    };
  }

  // Raw volume of evidence, saturating at one item per known EvidenceType -
  // an arbitrary but consistent target, same style as every prior 15D
  // engine's untuned round-number thresholds.
  private assessEvidenceQuantity(bundle: EvidenceBundle): ConfidenceCategoryScore {
    const total = bundle.items.length;
    const score = Math.min(100, Math.round((100 * total) / EVIDENCE_QUANTITY_TARGET));
    return {
      category: "evidence-quantity",
      score,
      rationale: [`${total} evidence item(s) collected`],
      basis: bundle.items,
    };
  }

  // Reuses Sprint 15D.5's own classification (supporting vs. opposing vs.
  // unresolved) rather than re-deriving agreement from raw conflicts - a
  // genuine consumption of ReasoningResult, not a parallel computation.
  private assessEvidenceAgreement(reasoning: ReasoningResult): ConfidenceCategoryScore {
    const classified = [...reasoning.supportingEvidence, ...reasoning.opposingEvidence, ...reasoning.unresolvedItems];
    if (classified.length === 0) {
      return {
        category: "evidence-agreement",
        score: 0,
        rationale: ["No evidence available - agreement cannot be assessed"],
        basis: [],
      };
    }
    const score = Math.round((100 * reasoning.supportingEvidence.length) / classified.length);
    return {
      category: "evidence-agreement",
      score,
      rationale: [
        `${reasoning.conflicts.length} unresolved conflict(s); ${reasoning.supportingEvidence.length} of ${classified.length} item(s) fully supporting`,
      ],
      basis: classified,
    };
  }

  // Distinct source count, saturating at an arbitrary target of 3 -
  // corroboration from multiple independent sources is worth more than
  // volume from a single one.
  private assessSourceDiversity(bundle: EvidenceBundle): ConfidenceCategoryScore {
    const total = bundle.items.length;
    if (total === 0) {
      return {
        category: "source-diversity",
        score: 0,
        rationale: ["No evidence available - source diversity cannot be assessed"],
        basis: [],
      };
    }
    const sources = new Set(bundle.items.map((item) => item.source));
    const score = Math.min(100, Math.round((100 * sources.size) / SOURCE_DIVERSITY_TARGET));
    return {
      category: "source-diversity",
      score,
      rationale: [`${sources.size} distinct source(s) contributed evidence`],
      basis: bundle.items,
    };
  }

  // Age of the single freshest item, computed directly from the bundle
  // (the same date-math EvidenceRankingService/ReasoningEngineService
  // already use) - deliberately independent of ReasoningResult's own
  // freshness driver text, so this never depends on parsing another
  // engine's rationale strings.
  private assessDataFreshness(bundle: EvidenceBundle, generatedAt: string): ConfidenceCategoryScore {
    if (bundle.items.length === 0) {
      return {
        category: "data-freshness",
        score: 0,
        rationale: ["No evidence available - freshness cannot be assessed"],
        basis: [],
      };
    }
    const generatedMs = new Date(generatedAt).getTime();
    let freshest = bundle.items[0];
    let freshestMs = new Date(freshest.asOf).getTime();
    for (const item of bundle.items) {
      const ms = new Date(item.asOf).getTime();
      if (ms > freshestMs) {
        freshest = item;
        freshestMs = ms;
      }
    }
    const ageMinutes = Math.max(0, Math.round((generatedMs - freshestMs) / 60_000));
    const score = ageMinutes <= FRESHNESS_WARNING_MINUTES ? 100 : ageMinutes <= FRESHNESS_STALE_MINUTES ? 60 : 20;
    return {
      category: "data-freshness",
      score,
      rationale: [`Freshest evidence is ${ageMinutes} minute(s) old`],
      basis: [freshest],
    };
  }

  // Breadth of EvidenceTypes represented in the raw bundle - "how many
  // domains did we even look at", independent of whether what was found
  // agreed or resolved cleanly (that is evidence-agreement/
  // unknown-factors' job).
  private assessCoverageCompleteness(bundle: EvidenceBundle): ConfidenceCategoryScore {
    const present = new Set(bundle.items.map((item) => item.type));
    const score = Math.round((100 * present.size) / ALL_EVIDENCE_TYPES.length);
    const representative = ALL_EVIDENCE_TYPES.filter((type) => present.has(type)).map(
      (type) => bundle.items.find((item) => item.type === type)!,
    );
    return {
      category: "coverage-completeness",
      score,
      rationale: [`${present.size} of ${ALL_EVIDENCE_TYPES.length} evidence types present`],
      basis: representative,
    };
  }

  // Residual ambiguity even after Sprint 15D.5's own analysis: entirely
  // absent evidence types (its assumptions) plus items it collected but
  // could not resolve into a supporting/opposing stance. Deliberately
  // reads ReasoningResult rather than the raw bundle (unlike
  // coverage-completeness above) - this measures resolution quality, not
  // raw breadth, so the two categories never derive from the same source
  // data even though they sound adjacent.
  private assessUnknownFactors(reasoning: ReasoningResult): ConfidenceCategoryScore {
    const classified = [...reasoning.supportingEvidence, ...reasoning.opposingEvidence, ...reasoning.unresolvedItems];
    const assumptionPenalty = Math.round((100 * reasoning.assumptions.length) / ALL_EVIDENCE_TYPES.length);
    const unresolvedPenalty =
      classified.length > 0 ? Math.round((30 * reasoning.unresolvedItems.length) / classified.length) : 0;
    const score = Math.max(0, 100 - Math.min(100, assumptionPenalty + unresolvedPenalty));
    return {
      category: "unknown-factors",
      score,
      rationale: [
        `${reasoning.assumptions.length} of ${ALL_EVIDENCE_TYPES.length} evidence types entirely unaddressed`,
        `${reasoning.unresolvedItems.length} of ${classified.length} classified item(s) left unresolved`,
      ],
      basis: reasoning.unresolvedItems,
    };
  }

  private buildDrivers(categories: readonly ConfidenceCategoryScore[]): ConfidenceContribution[] {
    return categories.map((c) => ({
      category: c.category,
      detail: c.rationale[0],
      impact: c.score >= 50 ? "positive" : "negative",
    }));
  }

  // Cross-cutting deductions sourced from the Sprint 15D.6 RiskProfile's
  // own overall verdict only - never restates a specific risk category
  // (that would double-count evidence already reflected in a category
  // score above). A "low" overall risk earns no penalty entry at all,
  // never a fabricated zero-point one.
  private buildPenalties(riskProfile: RiskProfile): ConfidencePenalty[] {
    const penalties: ConfidencePenalty[] = [];
    if (riskProfile.overallLevel === "high") {
      penalties.push({ reason: "Sprint 15D.6 Risk Intelligence Engine assessed overall risk as high", points: 20 });
    } else if (riskProfile.overallLevel === "medium") {
      penalties.push({ reason: "Sprint 15D.6 Risk Intelligence Engine assessed overall risk as medium", points: 8 });
    }
    return penalties;
  }

  private mergeBasis(categories: readonly ConfidenceCategoryScore[]): EvidenceItem[] {
    const seen = new Set<EvidenceItem>();
    const merged: EvidenceItem[] = [];
    for (const category of categories) {
      for (const item of category.basis) {
        if (!seen.has(item)) {
          seen.add(item);
          merged.push(item);
        }
      }
    }
    return merged;
  }

  private computeOverallScore(categories: readonly ConfidenceCategoryScore[], penalties: readonly ConfidencePenalty[]): number {
    const average = categories.reduce((sum, c) => sum + c.score, 0) / categories.length;
    const totalPenalty = penalties.reduce((sum, p) => sum + p.points, 0);
    return Math.max(0, Math.min(100, Math.round(average - totalPenalty)));
  }
}
