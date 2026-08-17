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
//
// Sprint D2.8.13 - Production Wiring & Decision UI. This is the SECOND
// real production caller of DecisionContextService (the chat route via
// IntelligencePresentationService is the first, wired in D2.8.12) - it was
// found to still omit microstructure entirely: `chatContext.resolve()` was
// never called with `includeMicrostructure: true`, and `decisionContext`
// was built without the 2nd (microstructure) argument. Both are now
// opted in, reusing D2.8.7's/D2.8.11's exact existing machinery - no
// second microstructure engine, no new formula. The Workspace Research
// panel (components/workspace/WorkspaceResearch.tsx) now genuinely
// receives a real `microstructureEvidence` for BTCUSD/ETHUSD, exactly like
// the chat path.
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
      // Sprint D2.8.13 - opt into the same real microstructure fetch the
      // chat path already uses (D2.8.7/D2.8.9). A non-Binance-mapped
      // instrument still costs zero extra network calls - the existing
      // capability gate inside RealTimeIntelligenceService.fetchMicrostructure()
      // is unchanged and untouched by this sprint.
      includeMicrostructure: true,
    });

    if (context.status !== "resolved" || !context.envelope || !context.dataQuality) {
      return { context };
    }

    // Sprint D2.8.13 - forward the real, already-fetched microstructure
    // snapshot (or undefined) into the same, unmodified DecisionContextService
    // every other caller uses - populates decisionContext.microstructureEvidence
    // (D2.8.11) only when real evidence exists.
    const decisionContext = this.decisionContextService.build(context.envelope, context.microstructure);
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
