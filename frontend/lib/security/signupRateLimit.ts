// lib/security/signupRateLimit.ts
// Sprint R1.3 - DB-persisted rate limit for unauthenticated, email-sending
// auth actions (signup, resend-verification, forgot-password). A scripted
// signup burst (200+ accounts in a few hours, 0 confirmations) got through
// because none of these actions had any throttling. Serverless functions
// don't share memory across invocations, so the limit has to live in the DB
// rather than an in-process counter.
import { prisma } from "@/lib/prisma";

const WINDOW_SHORT_MS = 10 * 60 * 1000; // 10 minutes
const WINDOW_LONG_MS = 24 * 60 * 60 * 1000; // 24 hours

const MAX_PER_IP_SHORT = 5;
const MAX_PER_IP_LONG = 30;
const MAX_PER_EMAIL_LONG = 3;

const SWEEP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type RateLimitAction = "signup" | "resend_verification" | "forgot_password";

export interface RateLimitResult {
  allowed: boolean;
  reason?: "ip_short" | "ip_long" | "email_long";
}

// Records the attempt and checks whether it should be allowed. Recording
// happens regardless of the auth result itself - bots don't care whether the
// downstream call succeeds, so the limit has to key off requests, not
// outcomes.
export async function checkSignupRateLimit(params: {
  action: RateLimitAction;
  ip: string;
  email?: string;
}): Promise<RateLimitResult> {
  const { action, ip, email } = params;
  const now = new Date();
  const shortWindowStart = new Date(now.getTime() - WINDOW_SHORT_MS);
  const longWindowStart = new Date(now.getTime() - WINDOW_LONG_MS);

  const [ipShortCount, ipLongCount, emailLongCount] = await Promise.all([
    prisma.signupAttempt.count({ where: { ip, createdAt: { gte: shortWindowStart } } }),
    prisma.signupAttempt.count({ where: { ip, createdAt: { gte: longWindowStart } } }),
    email
      ? prisma.signupAttempt.count({ where: { email, createdAt: { gte: longWindowStart } } })
      : Promise.resolve(0),
  ]);

  let result: RateLimitResult = { allowed: true };
  if (ipShortCount >= MAX_PER_IP_SHORT) {
    result = { allowed: false, reason: "ip_short" };
  } else if (ipLongCount >= MAX_PER_IP_LONG) {
    result = { allowed: false, reason: "ip_long" };
  } else if (email && emailLongCount >= MAX_PER_EMAIL_LONG) {
    result = { allowed: false, reason: "email_long" };
  }

  // Record the attempt (allowed or not) so repeated blocked tries keep
  // counting against the window instead of resetting it.
  await prisma.signupAttempt.create({ data: { ip, email, action } });

  // Best-effort sweep of old rows. Cheap with the (ip, createdAt) index and
  // never blocks the caller's result.
  void prisma.signupAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - SWEEP_MAX_AGE_MS) } } })
    .catch(() => {});

  return result;
}

export const RATE_LIMIT_MESSAGE = "Too many attempts. Please try again later.";
