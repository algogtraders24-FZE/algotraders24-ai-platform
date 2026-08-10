// types/intelligence-context-request.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration.
// IntelligenceContextRequest is the EXPLICIT statement of what the
// orchestrator will retrieve for a given IntelligenceQuery - every
// `include*` flag is derived mechanically from `scopes` (see
// `buildContextRequest()` in
// services/intelligence/query/intelligence-query-context.service.ts).
// No hidden implicit data gathering: a scope not requested is a flag
// not set, and downstream selection code gates on these flags rather
// than defaulting to "include everything."
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { IntelligenceQuery, IntelligenceQueryScope } from "./intelligence-query";

/**
 * Caller-supplied conversation continuity - context, never market truth.
 * The deterministic Intelligence Engine (D2.5.x/D2.6.1) remains the only
 * source of what's actually happening in the market; this only tells the
 * orchestrator which symbol/timeframe/prior analysis the trader was just
 * discussing, so a follow-up question like "what about Gold?" or "was
 * that correct?" can resolve context without re-stating it explicitly.
 */
export interface ConversationIntelligenceContext {
  activeSymbol?: MarketSymbol;
  activeTimeframe?: SignalTimeframe;
  previousAnalysisRunId?: string;
  previousHypothesisId?: string;
}

export interface IntelligenceContextRequest {
  query: IntelligenceQuery;
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;

  scopes: IntelligenceQueryScope[];

  includeCurrentState: boolean;
  includeRegime: boolean;
  includeHypotheses: boolean;
  includeEvidence: boolean;
  includeConflicts: boolean;
  includeRisk: boolean;
  includeHistoricalValidation: boolean;
  includeScore: boolean;
  includeInvalidation: boolean;
  includeMonitoring: boolean;
  includeMissingInformation: boolean;

  requestedAt: string;
}
