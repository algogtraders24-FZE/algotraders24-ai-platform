// services/intelligence/chat/intelligence-chat-context.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// The stable, chat-facing entry point every chat caller (today's knowledge
// chat route, a future admin tool, a future API) should use instead of
// constructing RealTimeIntelligenceService and its many engine
// dependencies directly. Deliberately thin: it does not re-implement any
// resolution/orchestration logic, it only adapts a raw chat turn (message
// + optional conversation continuity) into RealTimeIntelligenceService's
// own request shape and returns its verified result unchanged.
import type { ConversationIntelligenceContext } from "@/types/intelligence-context-request";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { VerifiedRealTimeIntelligenceContext } from "@/types/real-time-intelligence";
import { RealTimeIntelligenceService, type RealTimeIntelligenceDeps } from "@/services/intelligence/orchestration/real-time-intelligence.service";

export interface ResolveChatIntelligenceInput {
  requestId: string;
  /** Session-derived, never client-supplied. */
  userId: string;
  message: string;
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;
  conversationContext?: ConversationIntelligenceContext;
  crossProviderValidation?: boolean;
  requestedAt?: string;
}

export class IntelligenceChatContextService {
  private readonly realTime: RealTimeIntelligenceService;

  constructor(deps: { realTime?: RealTimeIntelligenceService } & RealTimeIntelligenceDeps = {}) {
    const { realTime, ...realTimeDeps } = deps;
    this.realTime = realTime ?? new RealTimeIntelligenceService(realTimeDeps);
  }

  async resolve(input: ResolveChatIntelligenceInput): Promise<VerifiedRealTimeIntelligenceContext> {
    return this.realTime.build({
      requestId: input.requestId,
      userId: input.userId,
      question: input.message,
      symbol: input.symbol,
      timeframe: input.timeframe,
      conversationContext: input.conversationContext,
      crossProviderValidation: input.crossProviderValidation,
      requestedAt: input.requestedAt,
    });
  }
}
