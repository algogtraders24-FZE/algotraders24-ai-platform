// services/rewards/fulfilmentService.ts
// (Server only.) Turns a verified payment into the contract: the contract row, the 4 scheduled rebate instalments, the
// reserve entry (the whole rebate is set aside today), the slot conversion, and the referral commission. One transaction,
// idempotent on the purchase (a replayed webhook returns the same contract). The licence and purchase were already created by
// issueLicenseForPurchase; its expiry was set to the end of the 12-month term by the webhook before issuing.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";
import { computeContractMoney, computeReferralShares } from "@/lib/rewards/money";
import { ledgerKey } from "@/lib/rewards/ledger";
import { resolveUpline } from "@/services/rewards/upline";
import { createCommission } from "@/services/rewards/commissionCredit";
import { notifyCommission } from "@/services/rewards/rewardNotifier";
import { issueContractDocument } from "@/services/rewards/contractDocument";
import { ensureCompanionLicense } from "@/services/rewards/companionLicense";

export type FulfilResult = { handled: false } | { handled: true; contractId: string; duplicate: boolean };


/** Second-platform licence, best effort: the contract and the main licence stand even if this fails; a replay (admin retry) tries again. */
async function tryCompanion(productKey: string, buyerId: string, providerRef: string, expiresAt: Date | null): Promise<void> {
  try {
    await ensureCompanionLicense({ productKey, buyerId, providerRef, expiresAt });
  } catch (e) {
    console.error("[rewards] second-platform licence failed (non-fatal):", e);
  }
}

export async function fulfilRewardCheckout(input: { intentId: string; providerRef: string }): Promise<FulfilResult> {
  const checkout = await prisma.rewardCheckout.findUnique({ where: { intentId: input.intentId } });
  if (!checkout) return { handled: false };
  if (checkout.status === "FULFILLED" && checkout.contractId) {
    await issueContractDocument(checkout.contractId); // a replay also finishes a document that failed the first time
    const first = await prisma.purchase.findUnique({ where: { providerRef: input.providerRef }, include: { entitlements: { include: { licenses: true } } } }).catch(() => null);
    await tryCompanion(checkout.productKey, checkout.userId, input.providerRef, first?.entitlements[0]?.licenses[0]?.expiresAt ?? null);
    return { handled: true, contractId: checkout.contractId, duplicate: true };
  }
  if (!isRewardProductKey(checkout.productKey)) throw new Error(`Unknown reward product "${checkout.productKey}"`);
  const product = REWARD_PRODUCTS[checkout.productKey];

  const purchase = await prisma.purchase.findUnique({
    where: { providerRef: input.providerRef },
    include: { entitlements: { include: { licenses: true } } },
  });
  if (!purchase) throw new Error("Verified payment has no purchase yet - cannot create the contract.");
  const licenseId = purchase.entitlements[0]?.licenses[0]?.id ?? null;
  const money = computeContractMoney(product, purchase.purchasedAt);

  // Referral: look the code up again. The link (attribution) is always recorded - it is how the chain above is found later. Each level is
  // then paid ONLY if that person has an active paid Pro plan and a verified identity at the moment the sale is verified. A level that
  // does not qualify earns nothing and its share is not passed up: the people above are judged on their own.
  let shares: ReturnType<typeof computeReferralShares> = [];
  let attribution: { partnerId: string; codeId: string } | null = null;
  if (checkout.refCode) {
    const ref = await prisma.referralCode.findUnique({ where: { code: checkout.refCode } });
    if (ref && ref.userId !== checkout.userId) {
      attribution = { partnerId: ref.userId, codeId: ref.id };
      const upline = await resolveUpline(ref.userId, checkout.userId, purchase.purchasedAt);
      shares = computeReferralShares(product, checkout.userId, upline);
    }
  }

  try {
    const credited: Array<{ commissionId: string; partnerId: string; level: number; amountCents: number }> = [];
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
          const made = await createCommission(tx, { purchaseRef: purchase.id, partnerId: s.partnerId, level: s.level, amountCents: s.amountCents, buyerId: checkout.userId, source: "CONTRACT", paidAt: purchase.purchasedAt });
          if (made.released) credited.push({ commissionId: made.id, partnerId: s.partnerId, level: s.level, amountCents: s.amountCents });
        }
      }
      await tx.rewardCheckout.update({ where: { id: checkout.id }, data: { status: "FULFILLED", purchaseId: purchase.id, contractId: contract.id, error: null } });
      await tx.rewardAuditEvent.create({
        data: { actor: "system", action: "contract.created", subjectType: "RewardContract", subjectId: contract.id, data: { productKey: product.key, purchaseId: purchase.id, reserveCents: money.reserveCents, referral: attribution ? shares.length : 0 } },
      });
      return contract.id;
    });
    // Document and activation come right after the money is recorded; if they fail the contract stays PENDING_DOCUMENT and is retried.
    // Partners are told only after the money is recorded; a failure here never touches the contract.
    for (const c of credited) await notifyCommission({ ...c, source: "CONTRACT", detail: product.name, buyerId: checkout.userId });
    await issueContractDocument(contractId);
    const mainLicense = licenseId ? await prisma.license.findUnique({ where: { id: licenseId }, select: { expiresAt: true } }).catch(() => null) : null;
    await tryCompanion(checkout.productKey, checkout.userId, input.providerRef, mainLicense?.expiresAt ?? null);
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
