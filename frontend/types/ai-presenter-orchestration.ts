// types/ai-presenter-orchestration.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Presenter reliability metadata ONLY - never an Intelligence
// Score component, never fed back into the deterministic engine. This is
// observability about how a response was PRODUCED (which provider, did it
// pass integrity, how long did it take), not a fact about the market.
export const AI_PRESENTER_ORCHESTRATION_VERSION = "1.0.0";

export type PresenterFailureCategory =
  | "unavailable"
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "malformed-response"
  | "integrity-rejection"
  | "provider-error";

export interface PresenterAttempt {
  provider: string;
  attempted: boolean;
  success: boolean;
  latencyMs?: number;
  failureCategory?: PresenterFailureCategory;
  /** Undefined when the attempt never reached the integrity check at all (e.g. unavailable, or the provider call itself failed). */
  integrityPassed?: boolean;
  timestamp: string;
}

export interface PresenterOrchestrationResult {
  /** Real presenter output - either a validated LLM response or the deterministic fallback's own text. Never an unvalidated LLM answer. */
  text: string;
  presentedBy: string;
  envelopeGeneratedAt: string;
  attempts: PresenterAttempt[];
  fallbackUsed: boolean;
}
