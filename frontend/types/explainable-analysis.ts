// types/explainable-analysis.ts
// Sprint 15D.9 - Explainable Intelligence Engine domain types. Standalone:
// consumes a Sprint 15D.8 MarketIntelligenceResult (unmodified) and
// produces a deterministic ExplainableAnalysis - a set of narrative
// sections built entirely by template interpolation over already-computed
// structured fields (counts, levels, evidence claims copied verbatim). No
// AI call, no prompt, no free-text generation of any kind: every sentence
// here is assembled by ExplainableAnalysisService from data the unmodified
// 15D.4-15D.8 engines already computed - never a new inference or a
// guessed narrative.
import type { MarketSymbol } from "./market";
import type { EvidenceItem } from "./evidence";

/** One narrative line paired with the concrete evidence it was derived from. Basis is empty only when the line describes an absence (e.g. "no evidence available"), never when it makes a claim. */
export interface ExplanationLine {
  text: string;
  basis: EvidenceItem[];
}

export interface ExplainableAnalysisMetadata {
  /** This explanation layer's own version - bumped when its template/derivation logic changes, independent of the pipeline's own version. */
  explainerVersion: string;
  /** Echoed from the input MarketIntelligenceResult.metadata.pipelineVersion, so a consumer can trace which pipeline run produced the data behind this explanation. */
  sourcePipelineVersion: string;
  /** Echoed from the input's own generatedAt - this layer reads no clock of its own, so the explanation is exactly as fresh as the intelligence it explains. */
  generatedAt: string;
}

/** Immutable: deep-frozen by ExplainableAnalysisService.explain() before being returned. */
export interface ExplainableAnalysis {
  symbol: MarketSymbol;
  executiveSummary: string;
  marketThesis: string;
  supportingEvidence: ExplanationLine[];
  opposingEvidence: ExplanationLine[];
  unknownFactors: string[];
  assumptions: string[];
  limitations: string[];
  confidenceSummary: string;
  riskSummary: string;
  recommendationBasis: string;
  metadata: ExplainableAnalysisMetadata;
}
