// services/intelligence/audit/explanation.service.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. Pure, synchronous, I/O-free builder: takes an already-
// computed IntelligenceDecisionContext (D2.6.1) plus the real market-data
// provenance for the same turn and regroups them into the structured
// "why am I seeing this?" shape traders/UI can render. No new
// computation, no network, no LLM call - see types/intelligence-
// explanation.ts's header for the full boundary this file exists inside.
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";
import type { AuditMarketDataProvenance } from "@/types/intelligence-audit-trace";
import type { IntelligenceExplanation } from "@/types/intelligence-explanation";
import { INTELLIGENCE_EXPLANATION_VERSION } from "@/types/intelligence-explanation";

export class ExplanationService {
  /** Pure: identical (decisionContext, marketData) always produces an identical IntelligenceExplanation. */
  build(decisionContext: IntelligenceDecisionContext, marketData: AuditMarketDataProvenance): IntelligenceExplanation {
    return {
      symbol: decisionContext.symbol,
      timeframe: decisionContext.timeframe,

      whatHappened: {
        currentState: decisionContext.currentState,
        regime: decisionContext.regimeContext,
      },
      why: {
        supportingEvidence: decisionContext.supportingEvidence,
      },
      whatDisagrees: {
        opposingEvidence: decisionContext.opposingEvidence,
        unresolvedConflicts: decisionContext.unresolvedConflicts,
      },
      whatCouldHappen: {
        hypotheses: decisionContext.primaryHypotheses,
      },
      whatWouldInvalidate: {
        conditions: decisionContext.invalidationConditions,
      },
      howStrong: {
        intelligenceScore: decisionContext.intelligenceScore,
        decisionState: decisionContext.state,
      },
      risk: {
        riskContext: decisionContext.riskContext,
      },
      historicalPerformance: {
        historicalContext: decisionContext.historicalContext,
      },
      whatIsMissing: {
        items: decisionContext.missingInformation,
      },
      whatDataWasUsed: {
        marketData,
      },

      generatedAt: decisionContext.generatedAt,
      version: INTELLIGENCE_EXPLANATION_VERSION,
    };
  }
}
