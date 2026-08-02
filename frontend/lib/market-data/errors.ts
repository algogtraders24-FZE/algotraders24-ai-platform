// lib/market-data/errors.ts
// Sprint 15D.3A - Typed provider errors for market-data adapters, mirroring
// lib/ai/errors.ts's AIProviderError exactly (kind/message/provider/cause).
// Consumers branch on `kind`, never on string-matching a message.
export type MarketDataErrorKind =
  | "unconfigured"
  | "unsupported_symbol"
  | "auth"
  | "rate_limit"
  | "http_error"
  // Sprint D2.2 (Phase 4) - a provider call exceeded its time budget. Kept
  // distinct from http_error so the reliability layer and consumers can treat
  // "too slow" separately from "the server answered with an error".
  | "timeout"
  | "invalid_response"
  | "unknown";

export class MarketDataProviderError extends Error {
  constructor(
    public readonly kind: MarketDataErrorKind,
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}
