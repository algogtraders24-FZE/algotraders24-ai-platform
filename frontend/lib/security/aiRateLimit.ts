// lib/security/aiRateLimit.ts
// AT24 Security Hardening P1.1 - AI endpoint abuse/cost protection.
// Two layers, both backed by the existing RequestLog table/infrastructure
// (services/tracking/RequestLogService.ts) - no new schema:
//   1. Per-user burst limiter: 20 requests / 10 minutes / user. A flat,
//      plan-independent technical anti-abuse ceiling (NOT a business quota -
//      see checkQuantChatMonthlyEntitlement for the one real business
//      limit this sprint touches).
//   2. Global emergency guard: 500 requests / 10 minutes / type,
//      platform-wide. A reasoned STARTING threshold, not one derived from
//      a real traffic baseline - production volume today is near-zero
//      (pre-Beta-launch), so there is no meaningful historical percentile
//      to derive from. This is a temporary, conservative circuit breaker
//      meant to catch a runaway loop or scripted abuse burst, never
//      intended to shape normal usage. Revisit after real Beta traffic
//      accumulates - changing this number later is a configuration change,
//      not a new security architecture.
//
// Concurrency: count-then-insert has an inherent TOCTOU race under naive
// concurrent execution (N simultaneous requests could all read the same
// under-limit count before any of them inserts). An earlier version of
// this file closed the race with a BLOCKING advisory lock
// (pg_advisory_xact_lock) held across the whole count+insert - that
// serialized concurrent same-key requests correctly, but each one held a
// live DB connection from Prisma's pool for the entire time it queued,
// so a burst of truly-simultaneous requests could exhaust the connection
// pool and start failing with "Unable to start a transaction in the
// given time" - a real regression caught by
// validate-ai-rate-limit.ts's 25-concurrent-request test, which would
// have made a burst of requests (exactly the scenario this guard exists
// for) capable of degrading the whole app, not just this endpoint.
//
// Fixed with pg_try_advisory_xact_lock (NON-blocking) instead: each
// attempt opens a short-lived transaction, tries to acquire the lock
// immediately, and either completes the count+insert (lock acquired) or
// releases the transaction right away and retries after a short jittered
// backoff (lock held by a concurrent request for the same key). No
// attempt ever blocks waiting for a connection, so a same-key burst can
// only ever contend with itself for a tiny fraction of a second - it
// cannot monopolize the pool or affect unrelated requests. If every
// retry loses the race (a very tight simultaneous burst on the exact
// same key), the request fails CLOSED (rate-limited) rather than
// throwing - the correct posture for an anti-abuse control.
import { prisma } from "@/lib/prisma";
import type { RequestLogType } from "@/services/tracking/RequestLogService";

export type AiRateLimitType = Extract<
  RequestLogType,
  "quant_chat" | "market_analysis" | "trading_copilot" | "algo_test_compile"
>;

const USER_BURST_WINDOW_MS = 10 * 60 * 1000;
const USER_BURST_LIMIT = 20;
const GLOBAL_GUARD_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_GUARD_LIMIT = 500;

// Sized for a full same-key burst to drain: up to USER_BURST_LIMIT (20)
// legitimate contenders may need to serialize through the lock one at a
// time under real deployed latency. Capped backoff keeps any single
// request's worst-case added latency bounded even though attempts are
// generous.
const LOCK_RETRY_ATTEMPTS = 40;
const LOCK_RETRY_BASE_MS = 40;
const LOCK_RETRY_MAX_DELAY_MS = 200;

export interface AiRateLimitResult {
  allowed: boolean;
  reason?: "user_burst" | "global_guard";
}

function advisoryLockKey(scope: "user" | "global", key: string): string {
  return `ai-rate-limit:${scope}:${key}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One short-lived attempt: try (non-blocking) to acquire both locks and, if
// successful, do the real count+insert check. Returns null if either lock
// was contended (caller should retry), never blocks.
async function tryOnce(
  userId: string,
  type: AiRateLimitType,
  userWindowStart: Date,
  globalWindowStart: Date,
): Promise<AiRateLimitResult | null> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const [{ acquired: gotUserLock }] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${advisoryLockKey("user", `${userId}:${type}`)})) AS acquired
        `;
        if (!gotUserLock) return null;

        const userCount = await tx.requestLog.count({
          where: { userId, type, createdAt: { gte: userWindowStart } },
        });
        if (userCount >= USER_BURST_LIMIT) {
          return { allowed: false, reason: "user_burst" as const };
        }

        const [{ acquired: gotGlobalLock }] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${advisoryLockKey("global", type)})) AS acquired
        `;
        if (!gotGlobalLock) return null;

        const globalCount = await tx.requestLog.count({
          where: { type, createdAt: { gte: globalWindowStart } },
        });
        if (globalCount >= GLOBAL_GUARD_LIMIT) {
          return { allowed: false, reason: "global_guard" as const };
        }

        await tx.requestLog.create({ data: { userId, type } });
        return { allowed: true };
      },
      // Each attempt's transaction body is fast (a try-lock + a count, at
      // most two of those) - what needs patience under heavy concurrent
      // contention is ACQUIRING a pool connection at all (Prisma's default
      // maxWait is 2s), not holding one, since we never block inside the
      // transaction. Bumped generously so acquisition pressure from many
      // simultaneous attempts surfaces as a slower retry loop here, not as
      // a thrown error.
      { maxWait: 10_000, timeout: 5_000 },
    );
  } catch {
    // Couldn't even acquire a pool connection / start the transaction in
    // time - treat exactly like a lost lock race: retry, never throw.
    return null;
  }
}

// Reserves a slot for this request (inserts the RequestLog row) as part of
// the same gate check, before the expensive AI call runs - so concurrent
// requests are counted against the limit the instant they're admitted,
// not after the (slow) AI call finishes.
export async function checkAndRecordAiRateLimit(
  userId: string,
  type: AiRateLimitType,
): Promise<AiRateLimitResult> {
  const now = new Date();
  const userWindowStart = new Date(now.getTime() - USER_BURST_WINDOW_MS);
  const globalWindowStart = new Date(now.getTime() - GLOBAL_GUARD_WINDOW_MS);

  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    const result = await tryOnce(userId, type, userWindowStart, globalWindowStart);
    if (result !== null) return result;
    const backoff = Math.min(LOCK_RETRY_BASE_MS * (attempt + 1), LOCK_RETRY_MAX_DELAY_MS);
    await sleep(backoff + Math.random() * 20);
  }

  // Every attempt lost the lock race - an extremely tight simultaneous
  // burst on the exact same key. Fail closed: treat as rate-limited
  // rather than erroring or silently admitting the request.
  return { allowed: false, reason: "user_burst" };
}

export const AI_RATE_LIMIT_MESSAGE = "Too many requests - please slow down and try again shortly.";
