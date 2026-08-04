// lib/market-data/error-dto.ts
// Sprint D2.3.S3 - the single standardized failure shape every market-data-
// facing route returns, so a client never has to branch on a different error
// format depending on which endpoint it called. This is a pure boundary-layer
// serialization built FROM the internal MarketDataProviderError contract
// (lib/market-data/errors.ts) - that internal contract is unchanged, so
// nothing above/below the route layer (providers, MarketDataService,
// reliability) needs to know this DTO exists.
import type { MarketDataErrorKind, MarketDataProviderError } from "./errors";

export type MarketDataFailureReason =
  | "unconfigured"
  | "unsupported_symbol"
  | "auth_error"
  | "rate_limited"
  | "provider_error"
  | "timeout"
  | "invalid_response"
  | "unknown";

export interface MarketDataErrorDTO {
  success: false;
  reason: MarketDataFailureReason;
  provider: string;
  /** Seconds the caller should wait before retrying, when known - never guessed for a reason with no natural retry hint. */
  retryAfter?: number;
  /** Whether any cache entry exists for the requested symbol, regardless of freshness - diagnostic only, this DTO never carries data. */
  cached: boolean;
  /** ISO 8601 UTC. */
  timestamp: string;
}

const REASON_MAP: Record<MarketDataErrorKind, MarketDataFailureReason> = {
  unconfigured: "unconfigured",
  unsupported_symbol: "unsupported_symbol",
  auth: "auth_error",
  rate_limit: "rate_limited",
  http_error: "provider_error",
  timeout: "timeout",
  invalid_response: "invalid_response",
  unknown: "unknown",
};

// Only reasons with a genuine, honest retry hint get one - e.g. "unconfigured"
// has no meaningful retryAfter (retrying won't add a missing API key).
const DEFAULT_RETRY_AFTER_SECONDS: Partial<Record<MarketDataFailureReason, number>> = {
  rate_limited: 60,
  timeout: 5,
  provider_error: 10,
};

export function reasonForKind(kind: MarketDataErrorKind): MarketDataFailureReason {
  return REASON_MAP[kind] ?? "unknown";
}

export function toMarketDataErrorDTO(
  error: MarketDataProviderError,
  opts: { cached: boolean; now?: () => number },
): MarketDataErrorDTO {
  const reason = reasonForKind(error.kind);
  return {
    success: false,
    reason,
    provider: error.provider,
    retryAfter: DEFAULT_RETRY_AFTER_SECONDS[reason],
    cached: opts.cached,
    timestamp: new Date(opts.now?.() ?? Date.now()).toISOString(),
  };
}

/** HTTP status a route should return for a given failure reason - one mapping, reused everywhere so routes never invent their own. */
export function statusCodeForReason(reason: MarketDataFailureReason): 400 | 429 | 502 | 503 {
  if (reason === "unconfigured") return 503;
  if (reason === "rate_limited") return 429;
  if (reason === "unsupported_symbol") return 400;
  return 502;
}
