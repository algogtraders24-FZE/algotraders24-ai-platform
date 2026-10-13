// services/rewards/commissionCredit.ts
// (Server only.) One place that turns a confirmed sale into referral commission rows, for Algo Contracts and for every other payment.
// With REWARDS_COMMISSION_HOLD_DAYS = 0 (the default) a commission is RELEASED the moment the payment is confirmed and the partner can
// withdraw it straight away; with a hold it stays PENDING until the daily check releases it. Either way the release is written to the ledger
// with an idempotency key, so a replayed payment cannot credit twice.
import type { Prisma } from "@/lib/generated/prisma/client";
import { commissionHoldDays } from "@/lib/rewards/config";
import { ledgerKey } from "@/lib/rewards/ledger";
import { addDays } from "@/lib/rewards/money";

type Db = Prisma.TransactionClient;

export interface CommissionInput {
  purchaseRef: string; // Purchase id, or "sub:<paymentId>"
  partnerId: string;
  level: number;
  amountCents: number;
  buyerId: string;
  source: "CONTRACT" | "PRODUCT" | "SUBSCRIPTION";
  paidAt: Date;
}

/** Creates the commission row (RELEASED at once when there is no hold) and, when released, its ledger entry. Throws P2002 on a replay - callers decide. */
export async function createCommission(db: Db, c: CommissionInput): Promise<{ released: boolean }> {
  const hold = commissionHoldDays();
  const availableAt = addDays(c.paidAt, hold);
  const releaseNow = hold === 0;
  const row = await db.referralCommission.create({
    data: {
      purchaseId: c.purchaseRef, partnerId: c.partnerId, level: c.level, amountCents: c.amountCents, buyerId: c.buyerId, source: c.source,
      status: releaseNow ? "RELEASED" : "PENDING", availableAt, releasedAt: releaseNow ? availableAt : null,
    },
  });
  if (releaseNow) {
    await db.rewardLedgerEntry.create({
      data: { userId: c.partnerId, type: "COMMISSION_RELEASED", amountCents: c.amountCents, refType: "ReferralCommission", refId: row.id, idempotencyKey: ledgerKey.commission(c.purchaseRef, c.level) },
    });
  }
  return { released: releaseNow };
}
