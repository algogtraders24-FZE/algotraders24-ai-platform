// services/rewards/referralStore.ts
// (Server only.) A member's referral code. Created on demand, only for accounts that could actually earn from it.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReferralCode } from "@/lib/rewards/referral";

export async function getReferralCode(userId: string): Promise<string | null> {
  const row = await prisma.referralCode.findUnique({ where: { userId }, select: { code: true } }).catch(() => null);
  return row?.code ?? null;
}

/** Returns the user's code, creating one if needed. Retries on the (very unlikely) collision of two random codes. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await getReferralCode(userId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.referralCode.create({ data: { userId, code: generateReferralCode() } });
      return row.code;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const raced = await getReferralCode(userId); // two clicks at once: the other request won
      if (raced) return raced;
    }
  }
  throw new Error("Could not allocate a referral code.");
}
