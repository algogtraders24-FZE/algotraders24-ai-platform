// lib/security/publicReadLimit.ts
// Best-effort per-IP limiter for PUBLIC read-only JSON endpoints (Live Results). The responses are CDN-cached, so only cache
// misses reach the server; this guards the origin against a scripted client that busts the cache with random query strings.
// In-memory and per server instance on purpose (no DB writes for a public read): it slows an abuser down, it is not a hard quota.

export interface PublicReadLimitOptions {
  max: number;
  windowMs: number;
  /** Cap on tracked keys so a rotating-IP flood cannot grow memory without bound. */
  maxKeys?: number;
}

export interface PublicReadLimiter {
  check(key: string, nowMs?: number): { allowed: boolean; retryAfterSec: number };
}

export function createPublicReadLimiter(opts: PublicReadLimitOptions): PublicReadLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5000;
  return {
    check(key, nowMs = Date.now()) {
      const cutoff = nowMs - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + opts.windowMs - nowMs) / 1000)) };
      }
      recent.push(nowMs);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const k of hits.keys()) {
          hits.delete(k);
          if (hits.size <= maxKeys) break;
        }
      }
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

/** The first x-forwarded-for entry, else x-real-ip, else "unknown" (all unknown clients share one bucket). */
export function clientKey(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Shared by the two Live Results JSON endpoints: 60 uncached requests per minute per IP. */
export const liveResultsReadLimiter = createPublicReadLimiter({ max: 60, windowMs: 60_000 });
