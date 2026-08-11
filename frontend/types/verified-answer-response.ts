// types/verified-answer-response.ts
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. The stable, trader-facing response contract a UI consumes
// instead of reaching into the D2.5.x/D2.6.x pipeline itself. Every field
// here is a direct copy of an already-computed, already-verified value -
// see services/intelligence/chat/verified-answer-response.service.ts's
// pure builder. This file computes nothing; it only names a shape.
//
// NON-NEGOTIABLE MEANING (repeat before touching this file): this is a
// PRESENTATION contract for verified intelligence, not a new intelligence
// surface. `intelligenceScore` is a quality/completeness score - never a
// probability of profit. `hypotheses` are falsifiable current views -
// never guaranteed predictions. Nothing here may ever be extended with a
// BUY/SELL field, a target price, a stop loss, a win-rate claim, or a
// probability of a trading outcome - the same permanent prohibition
// D2.6.1's IntelligenceDecisionContext established.
import type { MarketSymbol, MarketCategory } from "./market";
import type { SignalTimeframe } from "./signal";
import type { RegimeType } from "./intelligence-regime";
import type { EvidenceItem, EvidenceConflict } from "./evidence";
import type { IntelligenceScore } from "./intelligence-score";
import type {
  DecisionState,
  DecisionCurrentState,
  DecisionHypothesisContext,
  DecisionInvalidationItem,
  DecisionRiskContext,
  DecisionHistoricalContext,
  DecisionMissingInformationItem,
} from "./intelligence-decision-context";
import type { DataQualityState } from "./real-time-intelligence";

export const VERIFIED_ANSWER_RESPONSE_VERSION = "1.0.0";

/** Direct passthrough of the real Regime (D2.5.2) fields relevant to the header. */
export interface VerifiedAnswerMarketContext {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  /** Undefined when the symbol isn't in the instrument catalog's market-category mapping - never guessed. */
  market?: MarketCategory;
  regimeType: RegimeType;
  regimeConfidence: number;
  previousRegime?: RegimeType;
}

export interface VerifiedAnswerResponse {
  /** The real, integrity-validated presenter text (or the deterministic fallback's own text) - never an unvalidated LLM answer. */
  answer: string;
  decisionState: DecisionState;
  /** The real, unmodified D2.5.5 Intelligence Score - never recalculated here. */
  intelligenceScore: IntelligenceScore;
  dataStatus: DataQualityState;
  /** The real provider that served the market data, when genuinely known - undefined, never guessed, when provenance is unavailable. */
  provider?: string;
  /** True only when a real earlier-priority MARKET-DATA provider failed before `provider` succeeded (D2.6.3/D2.6.4's own MarketSnapshot.fallbackUsed) - distinct from, and never confused with, which AI presenter produced `answer` (see `presentedBy`). */
  fallbackUsed: boolean;
  marketContext: VerifiedAnswerMarketContext;
  /** Direct passthrough of DecisionCurrentState (D2.6.1) - price/trend/RSI/ATR/volatility/recent-range, never recomputed. */
  currentState: DecisionCurrentState;
  supportingEvidence: EvidenceItem[];
  opposingEvidence: EvidenceItem[];
  /** Real, already-detected conflicts with resolution === "unresolved" - never auto-resolved, never hidden behind a fake consensus. */
  unresolvedConflicts: EvidenceConflict[];
  /** May legitimately be empty - not every regime generates a hypothesis (D2.5.3). */
  hypotheses: DecisionHypothesisContext[];
  invalidationConditions: DecisionInvalidationItem[];
  riskContext: DecisionRiskContext;
  historicalContext: DecisionHistoricalContext;
  missingInformation: DecisionMissingInformationItem[];
  /** Which presenter actually produced `answer` - "gemini"/"claude"/"openai"/"deterministic-fallback" (D2.6.8). Disclosed as presentation provenance only, never implied to be the source of the underlying market intelligence. */
  presentedBy: string;
  /** Present only when a real, immutable audit trace (D2.6.9) was successfully persisted for this answer - best-effort, never blocks the answer itself. */
  auditTraceId?: string;
  generatedAt: string;
  version: string;
}
