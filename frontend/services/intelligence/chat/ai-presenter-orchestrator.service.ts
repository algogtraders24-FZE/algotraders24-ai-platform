// services/intelligence/chat/ai-presenter-orchestrator.service.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. The single seam a chat caller uses instead of calling a
// presenter directly (generalizing D2.6.5's single-presenter
// presentSafely() to a real provider priority chain). Responsibilities:
// select an available presenter, execute it, validate its response via
// the existing, UNMODIFIED AIResponseIntegrityService, and fall through
// to the next provider on ANY failure - never returning an unvalidated
// LLM answer. This file never computes market intelligence itself; it
// only orchestrates presentation of an already-verified IntelligenceEnvelope.
//
// Default priority: Gemini -> Claude -> OpenAI -> DeterministicSafeFallbackPresenter.
// An unavailable provider (missing API key) is skipped without ever being
// constructed - GeminiProvider/ClaudeProvider/OpenAIProvider's own
// constructors throw immediately on a missing key (lib/ai/env.ts's "fail
// fast" convention), so this orchestrator checks real env-var presence
// BEFORE construction, never relying on a try/catch around a throwing
// constructor as its primary availability signal (though one still
// exists as a defensive last resort - see the loop below).
//
// This is NOT an ensemble/voting model - every provider receives the
// exact same deterministic IntelligenceEnvelope; they may differ in
// wording, never in underlying market facts (see the architecture spec's
// explicit "why ensemble voting is intentionally not used" section).
import type { IntelligenceEnvelope, AIIntelligencePresenter } from "@/types/intelligence-envelope";
import type { PresenterAttempt, PresenterFailureCategory, PresenterOrchestrationResult } from "@/types/ai-presenter-orchestration";
import type { MicrostructureSnapshot } from "@/types/microstructure";
import type { MicrostructureEvidenceAssessment } from "@/types/microstructure-evidence-assessment";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { validateResponseIntegrity } from "@/services/intelligence/chat/ai-response-integrity.service";
import { GeminiIntelligencePresenter } from "@/services/intelligence/chat/gemini-intelligence-presenter.service";
import { DeterministicSafeFallbackPresenter } from "@/services/intelligence/chat/deterministic-safe-fallback-presenter.service";
import { ClaudeProvider } from "@/lib/ai/providers/claude.provider";
import { OpenAIProvider } from "@/lib/ai/providers/openai.provider";
import { AIProviderError, type AIErrorKind } from "@/lib/ai/errors";
// Sprint D2.8.8 - additive presentation-layer bridge. The locked
// AIIntelligencePresenter.present(envelope, userQuestion) interface below
// is never touched; this orchestrator (a D2.6.8 composition class, not
// that interface) enriches the plain-string `userQuestion` it forwards to
// each candidate presenter instead.
import { buildPresenterQuestionWithMicrostructure } from "@/lib/microstructure/microstructure-presentation";

export interface PresenterSlot {
  name: string;
  /** A cheap, synchronous, side-effect-free check (env-var presence) - never constructs the provider itself. */
  isAvailable: () => boolean;
  createPresenter: () => AIIntelligencePresenter;
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

// GeminiIntelligencePresenter is already provider-generic (D2.6.5) - it
// accepts any injected AIProvider and reports that provider's own real
// `name`, never a hardcoded "gemini" literal. Reused here for Claude/
// OpenAI too rather than writing two near-identical presenter classes.
export const DEFAULT_PRESENTER_SLOTS: readonly PresenterSlot[] = [
  { name: "gemini", isAvailable: () => hasEnv("GEMINI_API_KEY"), createPresenter: () => new GeminiIntelligencePresenter() },
  { name: "claude", isAvailable: () => hasEnv("ANTHROPIC_API_KEY"), createPresenter: () => new GeminiIntelligencePresenter({ provider: new ClaudeProvider() }) },
  { name: "openai", isAvailable: () => hasEnv("OPENAI_API_KEY"), createPresenter: () => new GeminiIntelligencePresenter({ provider: new OpenAIProvider() }) },
];

function classifyFailure(error: unknown): PresenterFailureCategory {
  if (error instanceof AIProviderError) {
    const map: Record<AIErrorKind, PresenterFailureCategory> = {
      auth: "authentication",
      rate_limit: "rate-limit",
      timeout: "timeout",
      network: "provider-error",
      invalid_input: "provider-error",
      invalid_output: "malformed-response",
      invalid_dimensions: "malformed-response",
      unknown: "provider-error",
    };
    return map[error.kind];
  }
  return "provider-error";
}

export interface AIPresenterOrchestratorOptions {
  slots?: readonly PresenterSlot[];
  fallback?: AIIntelligencePresenter;
  decisionContextService?: DecisionContextService;
  clock?: { now(): number };
}

export class AIPresenterOrchestratorService {
  private readonly slots: readonly PresenterSlot[];
  private readonly fallback: AIIntelligencePresenter;
  private readonly decisionContextService: DecisionContextService;
  private readonly clock: { now(): number };

  constructor(options: AIPresenterOrchestratorOptions = {}) {
    this.slots = options.slots ?? DEFAULT_PRESENTER_SLOTS;
    this.fallback = options.fallback ?? new DeterministicSafeFallbackPresenter();
    this.decisionContextService = options.decisionContextService ?? new DecisionContextService();
    this.clock = options.clock ?? { now: () => Date.now() };
  }

  /**
   * Sprint D2.8.8 - `microstructure` is an optional 3rd param (this method
   * is this orchestrator's own, not the locked AIIntelligencePresenter
   * interface), defaulting to undefined so every existing caller/test
   * behaves byte-identically. When supplied, it is (a) folded into the
   * `userQuestion` string every candidate presenter receives, framed as
   * additional verified evidence with an explicit safety boundary (see
   * buildMicrostructureLLMEvidenceBlock), and (b) passed to the integrity
   * validator so a response that honestly cites real microstructure
   * numbers is not misclassified as fabricated.
   *
   * Sprint D2.8.12 - `microstructureEvidence` is a new, additive, optional
   * 4th param: D2.8.11's own MicrostructureEvidenceAssessment
   * (confirms/contradicts/neutral/insufficient_evidence). Folded into the
   * same `userQuestion` string (via buildPresenterQuestionWithMicrostructure's
   * own new 3rd param) so every candidate presenter sees the already-
   * computed relationship, not just raw numbers it would otherwise have to
   * infer a direction from itself. This orchestrator performs no
   * recalculation of its own - the assessment is D2.8.11's, unchanged.
   */
  async present(
    envelope: IntelligenceEnvelope,
    userQuestion: string,
    microstructure?: MicrostructureSnapshot,
    microstructureEvidence?: MicrostructureEvidenceAssessment,
  ): Promise<PresenterOrchestrationResult> {
    const decisionContext = this.decisionContextService.build(envelope);
    const presenterQuestion = buildPresenterQuestionWithMicrostructure(userQuestion, microstructure, microstructureEvidence);
    const attempts: PresenterAttempt[] = [];

    for (const slot of this.slots) {
      const timestamp = new Date(this.clock.now()).toISOString();
      if (!slot.isAvailable()) {
        attempts.push({ provider: slot.name, attempted: false, success: false, failureCategory: "unavailable", timestamp });
        continue;
      }

      const startedAt = this.clock.now();
      try {
        const presenter = slot.createPresenter();
        const candidate = await presenter.present(envelope, presenterQuestion);
        const latencyMs = this.clock.now() - startedAt;

        if (candidate.text.trim().length === 0) {
          attempts.push({ provider: slot.name, attempted: true, success: false, latencyMs, failureCategory: "malformed-response", timestamp });
          continue;
        }

        const integrity = validateResponseIntegrity(candidate.text, envelope, decisionContext, microstructure);
        if (!integrity.valid) {
          // Sprint D2.6.9 - the closed violation-kind vocabulary is safe,
          // non-sensitive diagnostic metadata (never raw response text) -
          // recorded here because it can never be reconstructed later:
          // a rejected candidate's text is never surfaced or persisted
          // anywhere else in this pipeline.
          const integrityViolationKinds = integrity.violations.map((v) => v.kind);
          attempts.push({ provider: slot.name, attempted: true, success: false, latencyMs, integrityPassed: false, integrityViolationKinds, failureCategory: "integrity-rejection", timestamp });
          continue;
        }

        attempts.push({ provider: slot.name, attempted: true, success: true, latencyMs, integrityPassed: true, timestamp });
        return { text: candidate.text, presentedBy: candidate.presentedBy, envelopeGeneratedAt: candidate.envelopeGeneratedAt, attempts, fallbackUsed: false };
      } catch (error) {
        // A provider exception (construction throw, network failure,
        // timeout, malformed response the provider itself couldn't
        // parse) must never crash the pipeline - it's just this
        // provider's attempt failing, the loop moves on immediately.
        const latencyMs = this.clock.now() - startedAt;
        attempts.push({ provider: slot.name, attempted: true, success: false, latencyMs, failureCategory: classifyFailure(error), timestamp });
        continue;
      }
    }

    // Every real LLM provider was unavailable, failed, or produced a
    // response that failed integrity validation - never fabricate an
    // answer. The deterministic fallback restates only real, verified
    // facts (D2.6.5) and is itself always integrity-valid.
    const fallbackTimestamp = new Date(this.clock.now()).toISOString();
    const fallbackResult = await this.fallback.present(envelope, presenterQuestion);
    attempts.push({ provider: this.fallback.name, attempted: true, success: true, integrityPassed: true, timestamp: fallbackTimestamp });
    return { text: fallbackResult.text, presentedBy: fallbackResult.presentedBy, envelopeGeneratedAt: fallbackResult.envelopeGeneratedAt, attempts, fallbackUsed: true };
  }
}
