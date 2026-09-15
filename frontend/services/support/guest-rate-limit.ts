// services/support/guest-rate-limit.ts
// AT24 Support - P1. Best-effort, in-memory, per-IP rate limit for the guest
// support endpoint (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS14, SS23 OQ-3).
//
// DISCLOSED LIMITATION (contract SS14/SS23): this is per-process memory, not
// distributed. On Vercel's serverless model, separate function instances do
// not share this state, so a determined multi-instance abuser is not fully
// stopped by this alone. A production-grade distributed limiter (e.g.
// Upstash Redis) is explicitly out of scope for P1 - this is the disclosed,
// honestly-scoped interim control, not a claim of full protection. Revisit
// if guest-endpoint abuse is actually observed post-launch.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

// Bounds unbounded memory growth from many distinct IPs across the life of a
// function instance. A coarse full reset is an acceptable trade-off for a
// disclosed best-effort control (a legitimate caller loses at most one
// window's worth of history, never gets wrongly blocked longer).
const MAX_TRACKED_IPS = 5000;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if `ip` is still within its budget for the current window
 *  (and records this call against it); false if it should be rejected
 *  (HTTP 429). `now` is injectable for tests. */
export function checkGuestRateLimit(ip: string, now: number = Date.now()): boolean {
  if (buckets.size > MAX_TRACKED_IPS) buckets.clear();

  const existing = buckets.get(ip);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (existing.count >= MAX_REQUESTS_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}

/** Test-only: reset all tracked state between test cases. */
export function _resetGuestRateLimitForTests(): void {
  buckets.clear();
}
