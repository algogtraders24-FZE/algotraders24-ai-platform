// services/intelligence/chat/intelligence-chat-context.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// The stable, chat-facing entry point every chat caller (today's knowledge
// chat route, a future admin tool, a future API) should use instead of
// constructing RealTimeIntelligenceService and its many engine
// dependencies directly. Deliberately thin: it does not re-implement any
// resolution/orchestration logic, it only adapts a raw chat turn (message
// + optional conversation continuity) into RealTimeIntelligenceService's
// own request shape and returns its verified result unchanged.
//
// Sprint D2.6.7 - Conversation Continuity & Verified Market Context
// Memory. When `conversationId` is supplied, this is now also the ONE
// place persisted conversation context (types/conversation-context.ts)
// is loaded before resolution and saved after a resolved turn - every
// current and future caller of this service gets continuity for free,
// never needing to know ConversationContextService exists. An explicit
// `conversationContext` still wins over a persisted load (test/advanced-
// caller escape hatch, unchanged from D2.6.5). Persistence is best-
// effort: a save failure never breaks the response the trader already
// has - matches RealTimeIntelligenceService's own AnalysisRun
// persistence posture.
import type { ConversationIntelligenceContext } from "@/types/intelligence-context-request";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { VerifiedRealTimeIntelligenceContext } from "@/types/real-time-intelligence";
import { toConversationIntelligenceContext } from "@/types/conversation-context";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { RealTimeIntelligenceService, type RealTimeIntelligenceDeps } from "@/services/intelligence/orchestration/real-time-intelligence.service";
import { ConversationContextService, deriveNextContext } from "@/services/intelligence/chat/conversation-context.service";

export interface ResolveChatIntelligenceInput {
  requestId: string;
  /** Session-derived, never client-supplied. */
  userId: string;
  message: string;
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;
  /** When supplied, persisted context is loaded for this conversation before resolution and saved after a resolved turn. Omit for a stateless, one-off resolution. */
  conversationId?: string;
  /** Explicit override - wins over any persisted load for this call. */
  conversationContext?: ConversationIntelligenceContext;
  crossProviderValidation?: boolean;
  requestedAt?: string;
}

export class IntelligenceChatContextService {
  private readonly realTime: RealTimeIntelligenceService;
  private readonly conversationContext: ConversationContextService;

  constructor(deps: { realTime?: RealTimeIntelligenceService; conversationContext?: ConversationContextService } & RealTimeIntelligenceDeps = {}) {
    const { realTime, conversationContext, ...realTimeDeps } = deps;
    this.realTime = realTime ?? new RealTimeIntelligenceService(realTimeDeps);
    this.conversationContext = conversationContext ?? new ConversationContextService();
  }

  async resolve(input: ResolveChatIntelligenceInput): Promise<VerifiedRealTimeIntelligenceContext> {
    let conversationContext = input.conversationContext;
    if (!conversationContext && input.conversationId) {
      const persisted = await this.conversationContext.getContext(input.conversationId, input.userId);
      conversationContext = toConversationIntelligenceContext(persisted);
    }

    const result = await this.realTime.build({
      requestId: input.requestId,
      userId: input.userId,
      question: input.message,
      symbol: input.symbol,
      timeframe: input.timeframe,
      conversationContext,
      crossProviderValidation: input.crossProviderValidation,
      requestedAt: input.requestedAt,
    });

    if (input.conversationId && result.status === "resolved" && result.envelope) {
      const instrument = getCanonicalInstrument(result.envelope.symbol);
      const nowMs = new Date(result.generatedAt).getTime();
      const next = deriveNextContext(
        input.conversationId,
        input.userId,
        {
          symbol: result.envelope.symbol,
          // The query's OWN resolved timeframe - honestly undefined when
          // never specified/inherited, never the envelope's
          // computation-only default (see conversation-context.service.ts's
          // ResolvedTurnForContext header for why that distinction matters).
          timeframe: result.query.timeframe,
          exchange: instrument?.exchange,
          market: instrument?.marketCategory,
          analysisRunId: result.analysisRunId,
          queryType: result.query.queryType,
          hypothesisIds: result.envelope.hypotheses.map((h) => h.id),
          regimeType: result.envelope.regime.regimeType,
        },
        Number.isFinite(nowMs) ? nowMs : Date.now(),
      );
      await this.conversationContext.saveContext(next).catch(() => {
        // Best-effort - a persistence failure must never break the response the trader already has.
      });
    }

    return result;
  }
}
