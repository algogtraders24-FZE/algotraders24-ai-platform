// services/intelligence/chat/conversation-context.service.ts
// Sprint D2.6.7 - Conversation Continuity & Verified Market Context
// Memory. Persists/loads PersistedConversationContext (types/
// conversation-context.ts) on the existing Conversation row - no new
// table, no duplicate conversation storage. Every read/write is
// ownership-scoped in the SAME query (WHERE id AND userId), matching
// services/ai/conversation-ownership.service.ts's established idiom -
// never fetch-then-check.
import { prisma } from "@/lib/prisma";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { MarketCategory } from "@/types/market";
import type { IntelligenceQueryType } from "@/types/intelligence-query";
import type { RegimeType } from "@/types/intelligence-regime";
import { CONVERSATION_CONTEXT_VERSION, type PersistedConversationContext } from "@/types/conversation-context";

/**
 * What one resolved chat turn contributes toward the next persisted
 * context. Always the CURRENT turn's own real, fresh values - never a
 * merge with the previous context (see deriveNextContext's header for why
 * that makes the "symbol changed -> drop old pointers" replacement rule
 * hold true by construction, not by extra clearing logic).
 */
export interface ResolvedTurnForContext {
  symbol: MarketSymbol;
  /** The query's OWN resolved timeframe (honestly undefined when nothing was ever specified/inherited) - never the computation-only default a fresh analysis falls back to internally. Persisting the default here would make a later, unrelated question wrongly inherit it as if the trader had chosen it. */
  timeframe?: SignalTimeframe;
  exchange?: string;
  market?: MarketCategory;
  analysisRunId?: string;
  queryType?: IntelligenceQueryType;
  hypothesisIds?: string[];
  regimeType?: RegimeType;
}

/**
 * Pure, deterministic. Sprint §9/§16 - explicit replacement, never
 * time-based expiration: because this always builds a fresh object from
 * the CURRENT turn's own real values (never merges old
 * lastAnalysisRunId/lastHypothesisIds/lastRegimeType forward), a symbol
 * change on the next turn automatically carries only that new turn's own
 * pointers - there is no separate "clear stale fields" step to forget.
 */
export function deriveNextContext(conversationId: string, userId: string, turn: ResolvedTurnForContext, nowMs: number): PersistedConversationContext {
  return {
    contextVersion: CONVERSATION_CONTEXT_VERSION,
    conversationId,
    userId,
    activeSymbol: turn.symbol,
    activeTimeframe: turn.timeframe,
    activeExchange: turn.exchange,
    activeMarket: turn.market,
    lastAnalysisRunId: turn.analysisRunId,
    lastQueryType: turn.queryType,
    lastHypothesisIds: turn.hypothesisIds,
    lastRegimeType: turn.regimeType,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export class ConversationContextService {
  /** Null for a conversation with no resolved turn yet, a conversation belonging to another user, or a persisted shape from an incompatible future contextVersion (honestly discarded rather than risk misreading it) - every case collapses to "no context available", never a thrown error, since a fresh start is always a safe fallback. */
  async getContext(conversationId: string, userId: string): Promise<PersistedConversationContext | null> {
    const row = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, deletedAt: null },
      select: { intelligenceContext: true },
    });
    if (!row?.intelligenceContext) return null;
    const ctx = row.intelligenceContext as unknown as PersistedConversationContext;
    if (ctx.contextVersion !== CONVERSATION_CONTEXT_VERSION) return null;
    return ctx;
  }

  /** Ownership-scoped write - updateMany's WHERE includes userId directly, never a separate check after an unscoped update. A conversation that doesn't belong to this user (or doesn't exist) is silently a no-op, matching this service's own honest "no context available" posture rather than leaking existence via a thrown error. */
  async saveContext(context: PersistedConversationContext): Promise<void> {
    await prisma.conversation.updateMany({
      where: { id: context.conversationId, userId: context.userId, deletedAt: null },
      data: { intelligenceContext: context as object },
    });
  }
}
