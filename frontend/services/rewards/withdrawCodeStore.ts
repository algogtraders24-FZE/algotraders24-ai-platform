// services/rewards/withdrawCodeStore.ts
// (Server only.) Issues and checks the emailed 6-digit withdrawal code (members without an authenticator app). Only a salted hash is stored;
// a code lives 10 minutes, allows 5 wrong tries, works once, and a new code cancels the older ones. Asking for codes is rate limited.
import { prisma } from "@/lib/prisma";
import { CODE_TTL_MINUTES, MAX_ATTEMPTS, MAX_CODES_PER_HOUR, MIN_SECONDS_BETWEEN_CODES, codeMatches, expiresAtFor, generateCode, hashCode, newSalt, normalizeCode } from "@/lib/rewards/withdrawCode";

export type IssueResult = { ok: true; code: string; expiresAt: Date } | { ok: false; code: "TOO_SOON" | "TOO_MANY"; message: string };

export async function issueWithdrawCode(userId: string, now: Date = new Date()): Promise<IssueResult> {
  const recent = await prisma.rewardWithdrawCode.findMany({ where: { userId, createdAt: { gte: new Date(now.getTime() - 3_600_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (recent.length >= MAX_CODES_PER_HOUR) return { ok: false, code: "TOO_MANY", message: "Too many codes were requested. Please try again in a while." };
  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_CODES * 1000) {
    return { ok: false, code: "TOO_SOON", message: `Please wait ${MIN_SECONDS_BETWEEN_CODES} seconds before asking for another code.` };
  }
  const code = generateCode();
  const salt = newSalt();
  const expiresAt = expiresAtFor(now);
  // A new code replaces every older one that was not used yet.
  await prisma.$transaction([
    prisma.rewardWithdrawCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
    prisma.rewardWithdrawCode.create({ data: { userId, salt, codeHash: hashCode(code, salt, userId), expiresAt, createdAt: now } }),
  ]);
  return { ok: true, code, expiresAt };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "FORMAT" | "NO_CODE" | "EXPIRED" | "LOCKED" | "WRONG"; message: string };

export async function verifyWithdrawCode(userId: string, typed: unknown, now: Date = new Date()): Promise<VerifyResult> {
  const digits = normalizeCode(typed);
  if (!digits) return { ok: false, reason: "FORMAT", message: "Enter the 6-digit code." };
  const row = await prisma.rewardWithdrawCode.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row) return { ok: false, reason: "NO_CODE", message: "Ask for a new code first." };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "EXPIRED", message: `That code has expired (codes last ${CODE_TTL_MINUTES} minutes). Ask for a new one.` };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "LOCKED", message: "Too many wrong tries. Ask for a new code." };
  if (!codeMatches(digits, row.salt, userId, row.codeHash)) {
    await prisma.rewardWithdrawCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: "WRONG", message: "That code is not right." };
  }
  // Single use: only one concurrent request can flip usedAt from null.
  const used = await prisma.rewardWithdrawCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  return used.count === 1 ? { ok: true } : { ok: false, reason: "NO_CODE", message: "Ask for a new code first." };
}
