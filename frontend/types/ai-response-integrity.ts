// types/ai-response-integrity.ts
// Sprint D2.6.5 - deterministic checks on a presenter's natural-language
// output against the VerifiedRealTimeIntelligenceContext it was given.
// This validator is NOT another LLM - every check here is a pure,
// documented, regex/set-membership rule over real, already-verified data
// (never a second AI call judging the first).
export type ResponseIntegrityViolationKind =
  | "unsupported-numeric-claim"
  | "unsupported-symbol"
  | "unsupported-directional-claim"
  | "unsupported-indicator"
  | "unsupported-historical-claim"
  | "unsupported-confidence-claim"
  | "guaranteed-profit-language"
  | "contradicts-unresolved-conflict"
  | "contradicts-insufficient-data";

export interface ResponseIntegrityViolation {
  kind: ResponseIntegrityViolationKind;
  description: string;
  /** The exact substring/pattern that triggered this violation, when applicable - never fabricated when a check has no single matched span. */
  matchedText?: string;
}

export const AI_RESPONSE_INTEGRITY_VERSION = "1.0.0";

export interface ResponseIntegrityResult {
  valid: boolean;
  violations: ResponseIntegrityViolation[];
  checkedAt: string;
  version: string;
}
