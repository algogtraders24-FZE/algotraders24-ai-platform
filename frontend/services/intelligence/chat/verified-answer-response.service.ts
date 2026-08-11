// services/intelligence/chat/verified-answer-response.service.ts
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Pure, synchronous, I/O-free builder: regroups an already-
// computed IntelligenceEnvelope + IntelligenceDecisionContext +
// DataQualityAssessment + presenter result into the stable
// VerifiedAnswerResponse contract a frontend consumes. No new
// computation, no network, no LLM call - identical "reuse, never
// recompute" discipline as D2.6.9's ExplanationService.
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";
import type { DataQualityAssessment } from "@/types/real-time-intelligence";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import { VERIFIED_ANSWER_RESPONSE_VERSION } from "@/types/verified-answer-response";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";

export interface BuildVerifiedAnswerResponseInput {
  answer: string;
  envelope: IntelligenceEnvelope;
  decisionContext: IntelligenceDecisionContext;
  dataQuality: DataQualityAssessment;
  presentedBy: string;
  auditTraceId?: string;
}

/**
 * Pure: identical input always produces an identical VerifiedAnswerResponse.
 * `fallbackUsed` is deliberately NOT a separate input parameter - it is
 * derived from `dataQuality.fallbackUsed` (the real market-data provider
 * fallback signal, D2.6.3/D2.6.4) directly below, so there is no way for
 * a caller to accidentally pass a different signal (e.g. the AI-
 * presenter fallback, already disclosed separately via `presentedBy`)
 * into this field.
 */
export function buildVerifiedAnswerResponse(input: BuildVerifiedAnswerResponseInput): VerifiedAnswerResponse {
  const { envelope, decisionContext, dataQuality } = input;
  const instrument = getCanonicalInstrument(envelope.symbol);

  return {
    answer: input.answer,
    decisionState: decisionContext.state,
    intelligenceScore: decisionContext.intelligenceScore,
    dataStatus: dataQuality.state,
    provider: dataQuality.provider,
    fallbackUsed: dataQuality.fallbackUsed ?? false,
    marketContext: {
      symbol: envelope.symbol,
      timeframe: envelope.timeframe,
      market: instrument?.marketCategory,
      regimeType: envelope.regime.regimeType,
      regimeConfidence: envelope.regime.confidence,
      previousRegime: envelope.regime.previousRegime,
    },
    currentState: decisionContext.currentState,
    supportingEvidence: decisionContext.supportingEvidence,
    opposingEvidence: decisionContext.opposingEvidence,
    unresolvedConflicts: decisionContext.unresolvedConflicts,
    hypotheses: decisionContext.primaryHypotheses,
    invalidationConditions: decisionContext.invalidationConditions,
    riskContext: decisionContext.riskContext,
    historicalContext: decisionContext.historicalContext,
    missingInformation: decisionContext.missingInformation,
    presentedBy: input.presentedBy,
    auditTraceId: input.auditTraceId,
    generatedAt: envelope.generatedAt,
    version: VERIFIED_ANSWER_RESPONSE_VERSION,
  };
}
