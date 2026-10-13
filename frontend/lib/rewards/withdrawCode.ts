// lib/rewards/withdrawCode.ts
// (Pure apart from randomness.) The 6-digit confirmation a member must enter to withdraw. If the member has an authenticator app (TOTP) the
// code comes from that app and Supabase checks it; otherwise a one-time code is emailed to them. This file is the email-code part: how a
// code is made, stored (only a salted hash, never the code) and checked. Limits keep guessing hopeless: 6 digits, 10 minutes, 5 tries, one use.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const MIN_SECONDS_BETWEEN_CODES = 30;
export const MAX_CODES_PER_HOUR = 5;

/** A uniformly random 6-digit code, zero padded ("004217"). */
export function generateCode(rand: (max: number) => number = randomInt): string {
  return String(rand(1_000_000)).padStart(6, "0");
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashCode(code: string, salt: string, userId: string): string {
  return createHash("sha256").update(`${salt}:${userId}:${code}`).digest("hex");
}

/** Constant-time comparison of a typed code against the stored hash. */
export function codeMatches(typed: string, salt: string, userId: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(typed, salt, userId), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Accepts "123456" or "123 456"; returns the 6 digits or null. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export function expiresAtFor(now: Date): Date {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
}
