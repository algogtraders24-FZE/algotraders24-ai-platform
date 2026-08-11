// types/conversation-context.ts
// Sprint D2.6.7 - Conversation Continuity & Verified Market Context Memory.
// See docs/architecture/D2.6.7-conversation-continuity-spec.md for the
// full contract, resolution rules, and replacement policy this type
// exists to enforce.
//
// NON-NEGOTIABLE MEANING (repeat this before touching this file):
// conversation memory is CONTEXT, never CURRENT MARKET FACT. Every field
// here is either a pointer (a symbol/timeframe the trader was discussing,
// an analysis-run id, a hypothesis id) or a real, already-computed
// classification (a query type, a regime type from a PAST run) - never a
// price, indicator value, or any other number a fresh MarketDataService
// request could answer differently right now. RealTimeIntelligenceService
// (D2.6.5) always fetches live market data on every call; nothing in this
// type is ever substituted for that fetch.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { MarketCategory } from "./market";
import type { IntelligenceQueryType } from "./intelligence-query";
import type { RegimeType } from "./intelligence-regime";
import type { ConversationIntelligenceContext } from "./intelligence-context-request";

export const CONVERSATION_CONTEXT_VERSION = "1.0.0";

/**
 * Persisted on Conversation.intelligenceContext (Json, nullable) - one row
 * per conversation, always reflecting the MOST RECENT resolved turn, never
 * a transcript or a history array. `contextVersion` lets a future schema
 * change identify old persisted shapes rather than assuming the current
 * one.
 */
export interface PersistedConversationContext {
  contextVersion: string;
  conversationId: string;
  userId: string;

  /** The instrument the trader was most recently, explicitly or by inheritance, discussing. Undefined once explicitly replaced by a new topic - see the spec's §9 replacement rule, never time-expired. */
  activeSymbol?: MarketSymbol;
  activeTimeframe?: SignalTimeframe;
  /** Direct passthrough of CanonicalInstrument.exchange/marketCategory for the active symbol - real, catalog-sourced facts, never guessed. */
  activeExchange?: string;
  activeMarket?: MarketCategory;

  /** The IntelligenceAnalysisRun the most recent resolved turn persisted (D2.5.1) - a pointer for "that analysis"/"the previous analysis", never itself treated as current. */
  lastAnalysisRunId?: string;
  /** How the most recent turn's question was classified (D2.6.2) - informational, never re-interpreted as a rule. */
  lastQueryType?: IntelligenceQueryType;
  /** Real Hypothesis.id(s) (D2.5.3) from the most recent turn's envelope - almost always 0 or 1 entries, matching the hypothesis engine's own "at most one hypothesis per regime" behavior. Enables "what would invalidate it"/"this hypothesis" to identify WHICH hypothesis is being referenced; the actual invalidation answer still comes from a freshly recomputed hypothesis for the current market, never a replayed old one. */
  lastHypothesisIds?: string[];
  /** The regime classified in the most recent turn - historical record only, always re-classified fresh on the next request. */
  lastRegimeType?: RegimeType;

  updatedAt: string;
}

/**
 * Pure projection down to the narrower, already-existing D2.6.2 contract
 * (`types/intelligence-context-request.ts`) that IntelligenceQueryContextService/
 * RealTimeIntelligenceService already consume - this file's richer,
 * persisted superset is never a second parallel concept, just a durable
 * form of the same one. `undefined` in, `undefined` out - a
 * conversation with no resolved turn yet supplies no context at all,
 * exactly D2.6.5's existing default behavior.
 */
export function toConversationIntelligenceContext(ctx: PersistedConversationContext | null | undefined): ConversationIntelligenceContext | undefined {
  if (!ctx) return undefined;
  return {
    activeSymbol: ctx.activeSymbol,
    activeTimeframe: ctx.activeTimeframe,
    previousAnalysisRunId: ctx.lastAnalysisRunId,
    previousHypothesisId: ctx.lastHypothesisIds?.[0],
  };
}
