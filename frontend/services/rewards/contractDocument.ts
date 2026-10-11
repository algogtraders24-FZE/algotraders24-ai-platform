// services/rewards/contractDocument.ts
// (Server only.) Issues the contract PDF for a fulfilled checkout and turns the contract ACTIVE. Safe to run again: if the
// document already exists it only makes sure the contract is ACTIVE. A failure leaves the contract PENDING_DOCUMENT (instalments
// stay paused) so an admin or a retry can finish it - the buyer's payment and licence are never touched.
import { prisma } from "@/lib/prisma";
import { buildContractPdf } from "@/lib/rewards/contractPdf";
import { REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";
import { saveContractPdf, sha256Hex } from "@/lib/rewards/documentStorage";

export async function issueContractDocument(contractId: string): Promise<{ ok: true; alreadyIssued: boolean } | { ok: false; error: string }> {
  try {
    const contract = await prisma.rewardContract.findUnique({ where: { id: contractId } });
    if (!contract) return { ok: false, error: "Contract not found" };
    const existing = await prisma.rewardContractDocument.findUnique({ where: { contractId } });
    if (existing) {
      if (contract.status === "PENDING_DOCUMENT") await prisma.rewardContract.update({ where: { id: contractId }, data: { status: "ACTIVE" } });
      return { ok: true, alreadyIssued: true };
    }
    if (!isRewardProductKey(contract.productKey)) return { ok: false, error: "Unknown product" };
    const [user, installments] = await Promise.all([
      prisma.user.findUnique({ where: { id: contract.userId }, select: { name: true, email: true } }),
      prisma.rebateInstallment.findMany({ where: { contractId }, orderBy: { seq: "asc" } }),
    ]);
    if (!user) return { ok: false, error: "Buyer not found" };

    const issuedAt = new Date();
    const bytes = await buildContractPdf({
      contractId,
      productName: REWARD_PRODUCTS[contract.productKey].name,
      buyerName: user.name || user.email,
      buyerEmail: user.email,
      buyerUserId: contract.userId,
      licenseId: contract.licenseId,
      listPriceCents: contract.listPriceCents,
      rebateTotalCents: contract.rebateTotalCents,
      netPriceCents: contract.netPriceCents,
      schedule: installments.map((i) => ({ seq: i.seq, dueAt: i.dueAt, amountCents: i.amountCents })),
      startsAt: contract.startsAt,
      endsAt: contract.endsAt,
      termsVersion: contract.termsVersion,
      consentAt: contract.consentAt,
      issuedAt,
      legalEntityLines: (process.env.REWARDS_LEGAL_ENTITY_LINES ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    });
    const path = `contracts/${contractId}.pdf`;
    const hash = sha256Hex(bytes);
    await saveContractPdf(path, bytes);
    await prisma.$transaction([
      prisma.rewardContractDocument.create({ data: { contractId, storagePath: path, sha256: hash } }),
      prisma.rewardContract.update({ where: { id: contractId }, data: { status: "ACTIVE" } }),
      prisma.rewardAuditEvent.create({ data: { actor: "system", action: "contract.document_issued", subjectType: "RewardContract", subjectId: contractId, data: { sha256: hash } } }),
    ]);
    return { ok: true, alreadyIssued: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rewards] contract document failed:", contractId, message);
    return { ok: false, error: message.slice(0, 300) };
  }
}
