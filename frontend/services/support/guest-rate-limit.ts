// services/support/guest-rate-limit.ts
// AT24 Support - P1. Best-effort, in-memory, per-IP rate limit for the guest
// support endpoint (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS14, SS23 OQ-3).
//
// DISCLOSED LIMITATION - IN-MEMORY, NOT DISTRIBUTED (contract SS14/SS23,
// intentionally NOT changed by the P1 merge-blocker remediation - no Redis/
// DB-backed limiter is introduced here): this state lives in one server
// process's memory. On Vercel's serverless model, separate concurrent
// function instances each get their OWN 10/window budget - under real
// production load with N warm instances, the effective site-wide ceiling on
// the guest endpoint is closer to N x MAX_REQUESTS_PER_WINDOW than to a
// single global 10/min, and a cold start resets an instance's counters to
// zero. This is a genuinely weaker guarantee than "10 requests per minute,
// globally" - it is a per-instance backstop against a single script hammering
// one warm lambda, not a production-grade abuse control. A distributed
// limiter (e.g. Upstash Redis) is the correct fix if guest-endpoint abuse is
// ever actually observed post-launch; it is explicitly out of scope for P1.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

/** Derives the identity to rate-limit by, trusting only the value the
 *  platform's own edge/proxy appended - never a client-supplied header
 *  value outright (merge-blocker fix 2, P1 review). `X-Forwarded-For`'s
 *  LEFTMOST entry is whatever the connecting client sent and is trivially
 *  spoofable (a caller can set it to a fresh random value on every request
 *  and never hit the same bucket twice); its RIGHTMOST entry is the one
 *  appended by the last hop before this function - with exactly one
 *  trusted hop between the public internet and this route (the platform's
 *  own edge/proxy; this app adds no other reverse proxy of its own), that
 *  rightmost entry is the real socket peer the edge observed, which a
 *  client cannot forge. Falls back to `x-real-ip` (a single edge-set value
 *  some platforms provide instead of/alongside XFF) if XFF is absent, then
 *  the literal string "unknown" (all unknown-origin traffic then shares one
 *  bucket, which is the conservative failure mode - it can only make the
 *  limiter MORE strict, never bypassable). */
export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headers.get("x-real-ip") ?? "unknown";
}

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
