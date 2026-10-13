// services/rewards/universalReferral.ts
// (Server only.) Universal referral (docs/UNIVERSAL-REFERRAL-SPEC.md). Everything here is a no-op unless REFERRAL_ALL_PRODUCTS=true.
//   recordSignupAttribution: first-touch link between a brand-new account and the member whose /r/CODE link it came through.
//   creditReferralForPayment: percent commission (2/1/1/1) for one verified payment that is NOT an Algo Contract (those keep their fixed dollars).
// Both are best effort for the caller: the payment is already confirmed and must never be undone or hidden by a failure here.
import { cookies } from "next/headers";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { holdDays, referralAllProductsEnabled } from "@/lib/rewards/config";
import { addDays, computePercentShares } from "@/lib/rewards/money";
import { REF_COOKIE, normalizeReferralCode } from "@/lib/rewards/referral";
import { resolveUpline } from "@/services/rewards/upline";

const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Called after the session user is resolved. Only does work when the flag is on, the visitor still carries the referral cookie and the
 * account was created in the last 24 hours, so the common request costs nothing. First touch wins: an account is never re-attached.
 */
export async function recordSignupAttribution(userId: string, accountCreatedAt: Date): Promise<void> {
  try {
    if (!referralAllProductsEnabled()) return;
    if (Date.now() - accountCreatedAt.getTime() > NEW_ACCOUNT_WINDOW_MS) return;
    const raw = (await cookies()).get(REF_COOKIE)?.value;
    if (!raw) return;
    await attachSignupFromCode(userId, raw);
  } catch (e) {
    console.error("[referral] signup attribution failed (non-fatal):", e);
  }
}

/** The part that needs no request: attaches `userId` to the owner of `rawCode` (first touch, never self, never twice). Returns whether a link was recorded. */
export async function attachSignupFromCode(userId: string, rawCode: string): Promise<boolean> {
  if (!referralAllProductsEnabled()) return false;
  const code = normalizeReferralCode(rawCode);
  if (!code) return false;
  const ref = await prisma.referralCode.findUnique({ where: { code } });
  if (!ref || ref.userId === userId) return false;
  const already = await prisma.referralAttribution.findFirst({ where: { buyerId: userId }, select: { id: true } });
  if (already) return false;
  await prisma.referralAttribution.create({ data: { partnerId: ref.userId, buyerId: userId, codeId: ref.id } });
  return true;
}

export interface CreditResult { credited: number; reason?: "OFF" | "NO_PARTNER" | "NOTHING_TO_PAY" }

/**
 * `saleRef` identifies the payment: the Purchase id for a product, "sub:<paymentId>" for a subscription payment. (saleRef, level) is
 * unique in the database, so a replayed webhook cannot pay a level twice.
 */
export async function creditReferralForPayment(input: { buyerId: string; amountCents: number; saleRef: string; paidAt: Date; source: "PRODUCT" | "SUBSCRIPTION" }): Promise<CreditResult> {
  if (!referralAllProductsEnabled()) return { credited: 0, reason: "OFF" };
  const first = await prisma.referralAttribution.findFirst({ where: { buyerId: input.buyerId }, orderBy: { createdAt: "asc" }, select: { partnerId: true } });
  if (!first) return { credited: 0, reason: "NO_PARTNER" };
  const upline = await resolveUpline(first.partnerId, input.buyerId, input.paidAt);
  const shares = computePercentShares(input.amountCents, input.buyerId, upline);
  if (shares.length === 0) return { credited: 0, reason: "NOTHING_TO_PAY" };
  let credited = 0;
  for (const s of shares) {
    try {
      await prisma.referralCommission.create({
        data: { purchaseId: input.saleRef, partnerId: s.partnerId, level: s.level, amountCents: s.amountCents, buyerId: input.buyerId, source: input.source, status: "PENDING", availableAt: addDays(input.paidAt, holdDays()) },
      });
      credited++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already credited by an earlier delivery of the same payment
    }
  }
  return { credited };
}
