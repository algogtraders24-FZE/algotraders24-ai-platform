// lib/security/checkoutRateLimit.ts
// AT24 Security Hardening P2.2 - checkout abuse protection. A single
// shared per-user bucket across all 5 checkout-initiating endpoints
// (subscription Stripe checkout, subscription NOWPayments invoice,
// marketplace Stripe checkout, marketplace NOWPayments invoice,
// payment-link checkout) - a user hitting any combination of these
// repeatedly is exactly what this limiter exists to catch, so they share
// one counter rather than getting 10 free attempts on each of 5 routes
// (50 effective attempts).
//
// Unlike P1.3's login limiter, BOTH successful and failed checkout
// attempts count: the endpoint itself does real DB/provider work
// (creating a Stripe Checkout Session or a NOWPayments invoice) just by
// being called, regardless of whether the attempt later succeeds - that
// initiation cost is exactly what needs bounding, not just failures.
//
// This is deliberately a SEPARATE, dedicated enforcement module reusing
// the RequestLog table/type infrastructure directly (a new "checkout"
// RequestLogType value) - NOT a call into RequestLogService's own
// record()/countForUser() methods. RequestLogService stays a logging/
// observability helper; this file is the actual rate-limit gate, same
// separation of concerns as lib/security/aiRateLimit.ts.
//
// Concurrency: reuses aiRateLimit.ts's proven non-blocking
// pg_try_advisory_xact_lock + bounded retry design (see that file's own
// comments for the full history - an earlier BLOCKING lock design was
// found during P1.1 to risk exhausting the Prisma connection pool under
// a real concurrent burst). Each attempt is short-lived; concurrent
// requests for the same user serialize through short retries rather than
// holding a connection while blocked.
import { prisma } from "@/lib/prisma";

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_USER = 10;

const LOCK_RETRY_ATTEMPTS = 40;
const LOCK_RETRY_BASE_MS = 40;
const LOCK_RETRY_MAX_DELAY_MS = 200;

export interface CheckoutRateLimitResult {
  allowed: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryOnce(userId: string, windowStart: Date): Promise<CheckoutRateLimitResult | null> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${`checkout-rate-limit:${userId}`})) AS acquired
        `;
        if (!acquired) return null;

        const count = await tx.requestLog.count({
          where: { userId, type: "checkout", createdAt: { gte: windowStart } },
        });
        if (count >= MAX_PER_USER) {
          return { allowed: false };
        }

        await tx.requestLog.create({ data: { userId, type: "checkout" } });
        return { allowed: true };
      },
      { maxWait: 10_000, timeout: 5_000 },
    );
  } catch {
    return null;
  }
}

// Reserves a slot for this checkout attempt (inserts the RequestLog row)
// before the caller does any real checkout-provider work - call this
// first in every checkout route, before creating a Stripe Checkout
// Session or NOWPayments invoice.
export async function checkAndRecordCheckoutAttempt(userId: string): Promise<CheckoutRateLimitResult> {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    const result = await tryOnce(userId, windowStart);
    if (result !== null) return result;
    const backoff = Math.min(LOCK_RETRY_BASE_MS * (attempt + 1), LOCK_RETRY_MAX_DELAY_MS);
    await sleep(backoff + Math.random() * 20);
  }

  // Every attempt lost the lock race - fail closed (rate-limited) rather
  // than erroring or silently admitting the request.
  return { allowed: false };
}

export const CHECKOUT_RATE_LIMIT_MESSAGE = "Too many checkout attempts. Please try again shortly.";
