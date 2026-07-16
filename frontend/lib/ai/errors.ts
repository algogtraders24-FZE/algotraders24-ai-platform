// lib/ai/errors.ts
// Requirement #7: robust, typed errors. Consumers can branch on `kind`
// instead of string-matching. Normalized across ALL providers (LSP).
export type AIErrorKind =
  | "auth"
  | "rate_limit"
  | "network"
  | "timeout"
  | "unknown";

export class AIProviderError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
