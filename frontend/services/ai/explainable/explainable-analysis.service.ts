// services/ai/explainable/explainable-analysis.service.ts
// Sprint 15D.9 - Explainable Intelligence Engine. Standalone, deterministic,
// no AI call, no prompt, no model of any kind: converts an already-computed
// Sprint 15D.8 MarketIntelligenceResult into a narrative ExplainableAnalysis
// using only string interpolation over fields that were already computed by
// the unmodified 15D.4-15D.8 engines - counts, levels, and evidence claims
// copied verbatim. Nothing here infers, predicts, or invents a fact that
// isn't already present on the input.
//
// Never-fabricate-narrative policy: every branch below either (a) restates
// a concrete, already-computed value (a count, a level, a verbatim claim),
// or (b) states an explicit absence ("no X is available") when the
// underlying data is empty. There is no third case - a sentence is never
// synthesized from partial information by guessing the rest. In particular,
// marketThesis never asserts a directional call (bullish/bearish) that
// nothing in the pipeline actually computed - it reports what the price
// evidence says and whether it agrees, nothing more.
import type { EvidenceItem } from "@/types/evidence";
import type { ReasoningResult } from "@/types/reasoning";
import type { RiskCategoryScore, RiskProfile } from "@/types/risk-intelligence";
import type { ConfidenceCategoryScore, ConfidenceProfile } from "@/types/confidence-intelligence";
import type { MarketIntelligenceResult } from "@/types/market-intelligence-result";
import type { ExplainableAnalysis, ExplanationLine } from "@/types/explainable-analysis";

// Bumped only when this layer's own template/derivation logic changes -
// independent of MARKET_INTELLIGENCE_PIPELINE_VERSION (15D.8), which tracks
// the upstream pipeline's stage composition instead.
export const EXPLAINABLE_ANALYSIS_VERSION = "15D.9.0";

// Mirrors the deep-freeze utility in market-intelligence-pipeline.service.ts.
// Not imported from there (that function is private to its own file, and
// this file must not modify the 15D.8 pipeline to export it) - a small,
// independent copy, consistent with this project's existing precedent of
// duplicating short, stable local constants/utilities across engine files
// rather than introducing a shared module.
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function formatEvidenceLine(item: EvidenceItem): string {
  return `${item.claim} (source: ${item.source}, as of ${item.asOf})`;
}

export class ExplainableAnalysisService {
  /**
   * Produces a deterministic ExplainableAnalysis from a MarketIntelligenceResult.
   * Reads no clock of its own - `generatedAt` is always the input's own
   * timestamp, so calling this twice on the same (frozen) input always
   * produces byte-identical output.
   */
  explain(input: MarketIntelligenceResult): ExplainableAnalysis {
    const { symbol, evidence, reasoning, risk, confidence, metadata } = input;
    const providerName = metadata.providerStatus.status === "ok" ? metadata.providerStatus.provider : "an unknown provider";

    const analysis: ExplainableAnalysis = {
      symbol,
      executiveSummary: this.buildExecutiveSummary(symbol, evidence.items.length, providerName, risk, confidence),
      marketThesis: this.buildMarketThesis(symbol, reasoning),
      supportingEvidence: reasoning.supportingEvidence.map((item) => this.toLine(item)),
      opposingEvidence: reasoning.opposingEvidence.map((item) => this.toLine(item)),
      unknownFactors: this.buildUnknownFactors(reasoning, evidence.conflicts.length),
      assumptions: this.buildAssumptions(reasoning),
      limitations: this.buildLimitations(risk, confidence),
      confidenceSummary: this.buildConfidenceSummary(confidence),
      riskSummary: this.buildRiskSummary(risk),
      recommendationBasis: this.buildRecommendationBasis(symbol, confidence, risk),
      metadata: {
        explainerVersion: EXPLAINABLE_ANALYSIS_VERSION,
        sourcePipelineVersion: metadata.pipelineVersion,
        generatedAt: metadata.generatedAt,
      },
    };

    return deepFreeze(analysis);
  }

  private toLine(item: EvidenceItem): ExplanationLine {
    return { text: formatEvidenceLine(item), basis: [item] };
  }

  private buildExecutiveSummary(
    symbol: string,
    evidenceCount: number,
    providerName: string,
    risk: RiskProfile,
    confidence: ConfidenceProfile,
  ): string {
    return (
      `Explainable analysis for ${symbol}: overall risk is ${risk.overallLevel.toUpperCase()}, ` +
      `overall confidence is ${confidence.overallLevel.toUpperCase()} (score ${confidence.overallScore}/100), ` +
      `based on ${evidenceCount} evidence item(s) from ${providerName}.`
    );
  }

  // Reports what the price evidence actually says and whether it agrees -
  // never a directional (bullish/bearish) call, since nothing in the
  // pipeline computes one. Absence of price evidence is stated explicitly,
  // never silently skipped or replaced with a generic claim.
  private buildMarketThesis(symbol: string, reasoning: ReasoningResult): string {
    const supportingPrice = reasoning.supportingEvidence.filter((item) => item.type === "price");
    const contestedPrice = [...reasoning.opposingEvidence, ...reasoning.unresolvedItems].filter((item) => item.type === "price");

    if (supportingPrice.length === 0 && contestedPrice.length === 0) {
      return `No price evidence is available for ${symbol}; no market thesis can be formed.`;
    }
    if (contestedPrice.length === 0) {
      return `Price evidence for ${symbol} is consistent: ${supportingPrice.map((i) => i.claim).join("; ")}.`;
    }
    const supportingPart = supportingPrice.length > 0 ? supportingPrice.map((i) => i.claim).join("; ") : "none";
    return (
      `Price evidence for ${symbol} is contested. Supporting: ${supportingPart}. ` +
      `Contested: ${contestedPrice.map((i) => i.claim).join("; ")}.`
    );
  }

  private buildAssumptions(reasoning: ReasoningResult): string[] {
    if (reasoning.assumptions.length === 0) {
      return ["No assumptions were required; every evidence type was represented in the collected evidence."];
    }
    return reasoning.assumptions.map((a) => a.statement);
  }

  private buildUnknownFactors(reasoning: ReasoningResult, conflictCount: number): string[] {
    const lines: string[] = [];
    for (const item of reasoning.unresolvedItems) {
      lines.push(`Unresolved: "${item.claim}" (source: ${item.source}) could not be classified as supporting or opposing.`);
    }
    if (conflictCount > 0) {
      lines.push(`${conflictCount} unresolved evidence conflict(s) were detected across the evidence bundle.`);
    }
    if (lines.length === 0) {
      return ["No unresolved items or conflicts were found."];
    }
    return lines;
  }

  // Structural limitations of the system itself: risk categories with no
  // possible evidence source (basis is always empty - liquidity/execution
  // by design, see RiskEngineService) plus any confidence category the
  // Confidence Intelligence Engine itself scored low. Both are direct
  // pass-throughs of what those engines already computed - no new
  // judgment is made here about what counts as a "limitation".
  private buildLimitations(risk: RiskProfile, confidence: ConfidenceProfile): string[] {
    const structural = risk.categories
      .filter((c: RiskCategoryScore) => c.basis.length === 0)
      .map((c) => `${c.category} risk: ${c.rationale.join(" ")}`);
    const weakConfidence = confidence.categories
      .filter((c: ConfidenceCategoryScore) => c.score < 34)
      .map((c) => `${c.category} confidence is low (${c.score}/100): ${c.rationale.join(" ")}`);

    const combined = [...structural, ...weakConfidence];
    return combined.length > 0 ? combined : ["No structural limitations were identified."];
  }

  private buildConfidenceSummary(confidence: ConfidenceProfile): string {
    const negative = confidence.drivers.filter((d) => d.impact === "negative").map((d) => d.category);
    const negativePart =
      negative.length > 0 ? `Categories reducing confidence: ${negative.join(", ")}.` : "No category reduced confidence.";
    const penaltyPart =
      confidence.penalties.length > 0
        ? `Penalty applied: ${confidence.penalties.map((p) => `${p.reason} (-${p.points})`).join("; ")}.`
        : "No penalties were applied.";

    return (
      `Overall confidence is ${confidence.overallLevel.toUpperCase()} (score ${confidence.overallScore}/100). ` +
      `${negativePart} ${penaltyPart}`
    );
  }

  private buildRiskSummary(risk: RiskProfile): string {
    const high = risk.categories.filter((c) => c.level === "high").map((c) => c.category);
    const medium = risk.categories.filter((c) => c.level === "medium").map((c) => c.category);

    const highPart = high.length > 0 ? `High-risk categories: ${high.join(", ")}.` : "No category was assessed as high risk.";
    const mediumPart = medium.length > 0 ? ` Medium-risk categories: ${medium.join(", ")}.` : "";

    return `Overall risk is ${risk.overallLevel.toUpperCase()}. ${highPart}${mediumPart}`;
  }

  private buildRecommendationBasis(symbol: string, confidence: ConfidenceProfile, risk: RiskProfile): string {
    const basisCount = confidence.basis.length;
    const basisPart =
      basisCount === 0
        ? "currently none are available, so no recommendation can be responsibly made"
        : `including: ${confidence.basis.map((item) => item.claim).join("; ")}`;

    return (
      `Any recommendation for ${symbol} should be grounded in ${basisCount} evidence item(s), ${basisPart}, ` +
      `under an overall risk level of ${risk.overallLevel.toUpperCase()} and confidence level of ${confidence.overallLevel.toUpperCase()}.`
    );
  }
}
