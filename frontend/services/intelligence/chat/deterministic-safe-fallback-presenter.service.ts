// services/intelligence/chat/deterministic-safe-fallback-presenter.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// Sprint §12: when Gemini is unavailable, times out, produces invalid
// output, or violates response integrity, the platform must still return
// useful, verified information - never a broken experience. This
// presenter never calls an LLM; it deterministically formats the real
// IntelligenceDecisionContext (D2.6.1, built here via the same unmodified
// DecisionContextService every other consumer uses) into the exact
// section structure the sprint's own worked example gives.
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "@/types/intelligence-envelope";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { formatDecisionContextAsText } from "./decision-context-formatter";

export const DETERMINISTIC_SAFE_FALLBACK_PRESENTER_NAME = "deterministic-fallback";

export class DeterministicSafeFallbackPresenter implements AIIntelligencePresenter {
  readonly name = DETERMINISTIC_SAFE_FALLBACK_PRESENTER_NAME;
  private readonly decisionContextService: DecisionContextService;

  constructor(deps: { decisionContextService?: DecisionContextService } = {}) {
    this.decisionContextService = deps.decisionContextService ?? new DecisionContextService();
  }

  /** The question parameter is intentionally omitted - this presenter never
   * tailors its output to the phrasing of the question, only to the real,
   * verified envelope, so it can never accidentally answer a question it
   * wasn't asked with fabricated specificity. */
  async present(envelope: IntelligenceEnvelope): Promise<AIPresentationResult> {
    const decisionContext = this.decisionContextService.build(envelope);
    return {
      text: formatDecisionContextAsText(decisionContext),
      presentedBy: this.name,
      envelopeGeneratedAt: envelope.generatedAt,
    };
  }
}
