// services/rewards/fulfilmentService.ts
// (Server only.) Turns a verified payment into the contract: the contract row, the 4 scheduled rebate instalments, the
// reserve entry (the whole rebate is set aside today), the slot conversion, and the referral commission. One transaction,
// idempotent on the purchase (a replayed webhook returns the same contract). The licence and purchase were already created by
// issueLicenseForPurchase; its expiry was set to the end of the 12-month term by the webhook before issuing.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { HOLD_DAYS, REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";
import { addDays, computeContractMoney, computeReferralShares } from "@/lib/rewards/money";
import { canEarnReferral } from "@/lib/rewards/eligibility";
import { ledgerKey } from "@/lib/rewards/ledger";
import { loadUserFacts } from "@/lib/rewards/access";

export type FulfilResult = { handled: false } | { handled: true; contractId: string; duplicate: boolean };

export async function fulfilRewardCheckout(input: { intentId: string; providerRef: string }): Promise<FulfilResult> {
  const checkout = await prisma.rewardCheckout.findUnique({ where: { intentId: input.intentId } });
  if (!checkout) return { handled: false };
  if (checkout.status === "FULFILLED" && checkout.contractId) return { handled: true, contractId: checkout.contractId, duplicate: true };
  if (!isRewardProductKey(checkout.productKey)) throw new Error(`Unknown reward product "${checkout.productKey}"`);
  const product = REWARD_PRODUCTS[checkout.productKey];

  const purchase = await prisma.purchase.findUnique({
    where: { providerRef: input.providerRef },
    include: { entitlements: { include: { licenses: true } } },
  });
  if (!purchase) throw new Error("Verified payment has no purchase yet - cannot create the contract.");
  const licenseId = purchase.entitlements[0]?.licenses[0]?.id ?? null;
  const money = computeContractMoney(product, purchase.purchasedAt);

  // Referral: look the partner up again and re-check that they are still Pro + verified at the moment the sale is verified.
  let shares: ReturnType<typeof computeReferralShares> = [];
  let attribution: { partnerId: string; codeId: string } | null = null;
  if (checkout.refCode) {
    const ref = await prisma.referralCode.findUnique({ where: { code: checkout.refCode } });
    if (ref && ref.userId !== checkout.userId) {
      const partner = await prisma.user.findUnique({ where: { id: ref.userId }, select: { email: true } });
      if (canEarnReferral(await loadUserFacts(ref.userId, partner?.email), purchase.purchasedAt)) {
        attribution = { partnerId: ref.userId, codeId: ref.id };
        // Only the direct level is known today (a partner tree for levels 2-4 is not modelled); multi-level stays off.
        shares = computeReferralShares(product, checkout.userId, [ref.userId]);
      }
    }
  }

  try {
    const contractId = await prisma.$transaction(async (tx) => {
      const contract = await tx.rewardContract.create({
        data: {
          userId: checkout.userId,
          productKey: product.key,
          purchaseId: purchase.id,
          licenseId,
          status: "PENDING_DOCUMENT",
          listPriceCents: money.listPriceCents,
          rebateTotalCents: money.rebateTotalCents,
          netPriceCents: money.netPriceCents,
          startsAt: money.startsAt,
          endsAt: money.endsAt,
          termsVersion: checkout.termsVersion,
          consentAt: checkout.consentAt,
          consentIp: checkout.consentIp,
        },
      });
      await tx.rebateInstallment.createMany({
        data: money.schedule.map((s) => ({ contractId: contract.id, userId: checkout.userId, seq: s.seq, dueAt: s.dueAt, amountCents: s.amountCents, status: "SCHEDULED" })),
      });
      await tx.rewardReserveEntry.create({
        data: { contractId: contract.id, type: "RESERVED", amountCents: money.reserveCents, idempotencyKey: ledgerKey.reserve(contract.id) },
      });
      // The payment is confirmed, so the slot is taken even if the 30-minute hold had just lapsed.
      await tx.rewardSlotHold.updateMany({ where: { id: checkout.slotHoldId, status: { in: ["HELD", "EXPIRED"] } }, data: { status: "CONVERTED" } });
      if (attribution) {
        await tx.referralAttribution.create({ data: { partnerId: attribution.partnerId, buyerId: checkout.userId, codeId: attribution.codeId, purchaseId: purchase.id } });
        for (const s of shares) {
          await tx.referralCommission.create({
            data: { purchaseId: purchase.id, partnerId: s.partnerId, level: s.level, amountCents: s.amountCents, status: "PENDING", availableAt: addDays(purchase.purchasedAt, HOLD_DAYS) },
          });
        }
      }
      await tx.rewardCheckout.update({ where: { id: checkout.id }, data: { status: "FULFILLED", purchaseId: purchase.id, contractId: contract.id, error: null } });
      await tx.rewardAuditEvent.create({
        data: { actor: "system", action: "contract.created", subjectType: "RewardContract", subjectId: contract.id, data: { productKey: product.key, purchaseId: purchase.id, reserveCents: money.reserveCents, referral: attribution ? shares.length : 0 } },
      });
      return contract.id;
    });
    return { handled: true, contractId, duplicate: false };
  } catch (err) {
    // A replay raced past the status check: the unique purchaseId stops the second contract; return the first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.rewardContract.findUnique({ where: { purchaseId: purchase.id }, select: { id: true } });
      if (existing) return { handled: true, contractId: existing.id, duplicate: true };
    }
    throw err;
  }
}

/** Records that fulfilment failed after a confirmed payment, so an admin or a retry job can find it. The payment itself is untouched. */
export async function markCheckoutFailed(intentId: string, error: unknown): Promise<void> {
  await prisma.rewardCheckout
    .updateMany({ where: { intentId, status: { not: "FULFILLED" } }, data: { status: "FAILED", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) } })
    .catch(() => undefined);
}
