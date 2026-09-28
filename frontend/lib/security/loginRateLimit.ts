// lib/security/loginRateLimit.ts
// AT24 Security Hardening P1.3 - login brute-force protection. Reuses the
// exact same SignupAttempt table/infrastructure as
// lib/security/signupRateLimit.ts (same serverless-safe DB-persisted
// reasoning: no shared in-process memory across invocations) - zero new
// schema, just a new `action` value ("login").
//
// Deliberately a SEPARATE function, not a call into checkSignupRateLimit:
// that helper always records every attempt (allowed or not) in one
// combined check+record step, which is correct for signup (bots don't
// care whether the call below it succeeds). Login is different - a
// legitimate user's SUCCESSFUL login must never count against their own
// limit, or a normal user who logs in often would eventually lock
// themselves out. So this is a genuine two-step API: check first
// (read-only), then the caller explicitly records a row ONLY on a
// failed authentication attempt.
import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 5;

export interface LoginRateLimitResult {
  allowed: boolean;
  reason?: "ip" | "email";
}

// Read-only: counts existing FAILED-login rows (action: "login") in the
// window. Call before attempting authentication.
export async function checkLoginRateLimit(params: {
  ip: string;
  email: string;
}): Promise<LoginRateLimitResult> {
  const { ip, email } = params;
  const windowStart = new Date(Date.now() - WINDOW_MS);

  const [ipCount, emailCount] = await Promise.all([
    prisma.signupAttempt.count({ where: { ip, action: "login", createdAt: { gte: windowStart } } }),
    prisma.signupAttempt.count({ where: { email, action: "login", createdAt: { gte: windowStart } } }),
  ]);

  if (ipCount >= MAX_PER_IP) return { allowed: false, reason: "ip" };
  if (emailCount >= MAX_PER_EMAIL) return { allowed: false, reason: "email" };
  return { allowed: true };
}

// Call ONLY after a failed authentication attempt (wrong password, unknown
// email, etc.) - never after a successful login, so a legitimate user's
// own normal usage can never lock them out.
export async function recordFailedLogin(params: { ip: string; email: string }): Promise<void> {
  await prisma.signupAttempt.create({ data: { ip: params.ip, email: params.email, action: "login" } });
}

export const LOGIN_RATE_LIMIT_MESSAGE = "Too many failed attempts. Please try again later.";
