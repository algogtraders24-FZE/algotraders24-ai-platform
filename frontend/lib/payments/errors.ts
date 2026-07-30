// lib/payments/errors.ts
// Sprint L2.7 - Typed provider errors for payment adapters, mirroring
// lib/market-data/errors.ts's MarketDataProviderError exactly. Consumers
// branch on `kind`, never on string-matching a message - "unconfigured" is
// the one every route must check first, so a missing key never surfaces
// as a generic 500 or, worse, a silently-ignored no-op.
export type PaymentErrorKind =
  | "unconfigured"
  | "invalid_signature"
  | "auth"
  | "http_error"
  | "invalid_response"
  | "unknown";

export class PaymentProviderError extends Error {
  constructor(
    public readonly kind: PaymentErrorKind,
    message: string,
    public readonly provider: "stripe" | "nowpayments",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
