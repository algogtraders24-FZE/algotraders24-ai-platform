// services/intelligence/chat/research-snapshot.service.ts
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. Powers the Workspace Research panel with a
// real VerifiedAnswerResponse for the active symbol WITHOUT a conversational
// AI presenter call - Research is a data view, not a chat turn, and this
// keeps it fast, deterministic, and free of an unnecessary LLM round trip.
//
// This is a thin, additive composition only - it reuses the exact same
// chat-facing boundary D2.6.5-D2.6.9 already established
// (IntelligenceChatContextService -> DecisionContextService ->
// buildVerifiedAnswerResponse, D2.6.1/D2.6.10, all unmodified) rather than
// inventing a second research engine or a second formula. `answer` is a
// short, deterministic, non-AI-generated summary line (never presented as
// AI-authored prose) - `presentedBy: "deterministic-research-snapshot"`
// makes that explicit, matching D2.6.10's own "Presented by X" disclosure
// convention.
import { IntelligenceChatContextService } from "@/services/intelligence/chat/intelligence-chat-context.service";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { buildVerifiedAnswerResponse } from "@/services/intelligence/chat/verified-answer-response.service";
import type { VerifiedRealTimeIntelligenceContext } from "@/types/real-time-intelligence";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import type { MarketSymbol } from "@/types/market";

export interface ResearchSnapshotInput {
  requestId: string;
  userId: string;
  symbol: MarketSymbol;
}

export interface ResearchSnapshotResult {
  context: VerifiedRealTimeIntelligenceContext;
  verifiedAnswer?: VerifiedAnswerResponse;
}

// Stateless: Research is a read-only view of the CURRENT active symbol, not
// a conversational turn - a fixed, neutral query text is used purely to
// satisfy IntelligenceQueryService's parser input; no conversationId is
// passed (no message persisted, no continuity state touched).
const RESEARCH_QUERY_TEXT = "Current market state, evidence, hypotheses, risk, and historical validation.";

export class ResearchSnapshotService {
  private readonly chatContext: IntelligenceChatContextService;
  private readonly decisionContextService: DecisionContextService;

  constructor(deps: { chatContext?: IntelligenceChatContextService; decisionContextService?: DecisionContextService } = {}) {
    this.chatContext = deps.chatContext ?? new IntelligenceChatContextService();
    this.decisionContextService = deps.decisionContextService ?? new DecisionContextService();
  }

  async build(input: ResearchSnapshotInput): Promise<ResearchSnapshotResult> {
    const context = await this.chatContext.resolve({
      requestId: input.requestId,
      userId: input.userId,
      message: RESEARCH_QUERY_TEXT,
      symbol: input.symbol,
    });

    if (context.status !== "resolved" || !context.envelope || !context.dataQuality) {
      return { context };
    }

    const decisionContext = this.decisionContextService.build(context.envelope);
    const verifiedAnswer = buildVerifiedAnswerResponse({
      answer: `Deterministic intelligence snapshot for ${context.envelope.symbol} (${context.envelope.timeframe}) - regime "${context.envelope.regime.regimeType}".`,
      envelope: context.envelope,
      decisionContext,
      dataQuality: context.dataQuality,
      presentedBy: "deterministic-research-snapshot",
    });

    return { context, verifiedAnswer };
  }
}
