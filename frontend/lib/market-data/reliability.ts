// lib/market-data/reliability.ts
// Sprint D2.2 (Phase 4) - per-call resilience primitives for market-data
// provider calls: a hard timeout, and bounded retry with exponential backoff
// on TRANSIENT failures only. Composed as withReliability(), which the central
// MarketDataService wraps around every provider call from its single attempt()
// seam - so resilience is added once, for every provider, without changing the
// selection/fallback logic.
//
// Retry policy is deliberately narrow: only "http_error" and "timeout" are
// retried (a flaky network or a slow response may succeed on a second try).
// "rate_limit", "auth", "unsupported_symbol", "invalid_response", and
// "unconfigured" are NOT retried - hammering a rate-limited or misconfigured
// provider only wastes budget and time. Those fail fast so the service can
// fall back to the next provider immediately (graceful fallback).
//
// All errors leaving this layer are already-normalized MarketDataProviderError
// values - a timeout becomes MarketDataProviderError("timeout", ...), never a
// raw AbortError or a bare Promise rejection.
import { MarketDataProviderError, type MarketDataErrorKind } from "./errors";

const RETRYABLE_KINDS: ReadonlySet<MarketDataErrorKind> = new Set(["http_error", "timeout"]);

export function isRetryableKind(kind: MarketDataErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

export interface ReliabilityOptions {
  /** Hard per-attempt time budget in ms. */
  timeoutMs?: number;
  /** Number of RETRIES after the first attempt (so total attempts = retries + 1). */
  retries?: number;
  /** Base backoff delay in ms; grows exponentially per retry (base * 2^n). */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay in ms. */
  maxDelayMs?: number;
  /** Injectable sleep so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG (0..1) for jitter, so backoff is deterministic under test. */
  random?: () => number;
}

const DEFAULTS = {
  timeoutMs: 8_000,
  retries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
} as const;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Races an operation against a timeout, throwing a normalized "timeout" provider error if the budget is exceeded. */
export async function withTimeout<T>(op: () => Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MarketDataProviderError("timeout", `${provider} timed out after ${timeoutMs}ms`, provider)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs `op` with a per-attempt timeout and bounded exponential-backoff retry
 * on transient provider errors. `op` receives the zero-based attempt index.
 * A non-MarketDataProviderError propagates immediately (never retried, never
 * swallowed) so a genuine bug is never masked as a transient failure.
 */
export async function withReliability<T>(
  op: (attempt: number) => Promise<T>,
  provider: string,
  options: ReliabilityOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = options.retries ?? DEFAULTS.retries;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: MarketDataProviderError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(() => op(attempt), timeoutMs, provider);
    } catch (error) {
      if (!(error instanceof MarketDataProviderError)) throw error;
      lastError = error;
      const canRetry = attempt < retries && isRetryableKind(error.kind);
      if (!canRetry) throw error;
      // Exponential backoff with full jitter, capped at maxDelayMs.
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(Math.floor(random() * ceiling));
    }
  }
  // Unreachable in practice (the loop either returns or throws), but keeps the
  // type checker honest without inventing a success.
  throw lastError ?? new MarketDataProviderError("unknown", `${provider} failed with no error captured`, provider);
}
