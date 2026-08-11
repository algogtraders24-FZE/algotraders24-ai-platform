// services/intelligence/chat/gemini-intelligence-presenter.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// The first production-safe AIIntelligencePresenter (D2.5.5's own
// interface). Built around the generic, already-multi-provider-ready
// AIProvider abstraction (lib/ai/provider.interface.ts) - never a
// Gemini-specific transport hardcoded here - so a future
// ClaudeIntelligencePresenter/OpenAIIntelligencePresenter is a drop-in
// sibling class, never a rewrite of this one (sprint §13).
//
// This presenter receives ONLY the real IntelligenceEnvelope and the
// trader's raw question - never provider credentials, never database
// write authority, never market-data tools, never web access, never
// broker execution tools (sprint §9). It builds the verified-facts block
// via the same DecisionContextService/formatDecisionContextAsText the
// deterministic fallback presenter uses, so both presenters are
// demonstrably drawing from the identical real facts.
import type { AIProvider } from "@/lib/ai/provider.interface";
import { GeminiProvider } from "@/lib/ai/providers/gemini.provider";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "@/types/intelligence-envelope";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { formatDecisionContextAsText } from "./decision-context-formatter";

export const GEMINI_INTELLIGENCE_PRESENTER_VERSION = "1.0.0";

// Sprint §10 - verbatim system instruction. Every line here is a
// permanent guardrail, not a suggestion: AIResponseIntegrityService
// (ai-response-integrity.service.ts) independently, deterministically
// checks the presenter's actual output against these same rules - this
// instruction is the first line of defense, that validator is the second.
export const GEMINI_PRESENTER_SYSTEM_INSTRUCTION = [
  "You are a presenter of verified market intelligence.",
  "",
  "You must not introduce facts that are absent from the supplied intelligence context.",
  "",
  "You must not invent prices, indicators, market conditions, historical outcomes, probabilities, risks, or predictions.",
  "",
  "If information is missing or unresolved, say so.",
  "",
  "Do not convert a hypothesis into a guaranteed prediction.",
  "",
  "Do not present IntelligenceScore as probability of profit.",
  "",
  "Do not claim that an analysis guarantees a trading outcome.",
].join("\n");

export class GeminiIntelligencePresenter implements AIIntelligencePresenter {
  private readonly provider: AIProvider;
  private readonly decisionContextService: DecisionContextService;

  constructor(deps: { provider?: AIProvider; decisionContextService?: DecisionContextService } = {}) {
    this.provider = deps.provider ?? new GeminiProvider();
    this.decisionContextService = deps.decisionContextService ?? new DecisionContextService();
  }

  /** Reflects the real underlying AIProvider's own name, not a hardcoded literal - a test-injected fake provider is never misreported as "gemini". */
  get name(): string {
    return this.provider.name;
  }

  async present(envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult> {
    const decisionContext = this.decisionContextService.build(envelope);
    const factsBlock = formatDecisionContextAsText(decisionContext);

    const response = await this.provider.complete({
      messages: [
        { role: "system", content: GEMINI_PRESENTER_SYSTEM_INSTRUCTION },
        {
          role: "user",
          content:
            `VERIFIED INTELLIGENCE CONTEXT (the ONLY source of facts you may use - do not add anything not stated here):\n\n${factsBlock}\n\n` +
            `Trader question: ${userQuestion}\n\n` +
            "Respond in plain, clear language. Preserve every uncertainty, unresolved conflict, insufficient-data state, and invalidation condition exactly as given above - never smooth them into false confidence.",
        },
      ],
    });

    return { text: response.content, presentedBy: this.provider.name, envelopeGeneratedAt: envelope.generatedAt };
  }
}
