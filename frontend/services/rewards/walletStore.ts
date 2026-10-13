// services/rewards/walletStore.ts
// (Server only.) Loads everything that moved in a member's balance and turns it into wallet entries (lib/rewards/wallet.ts). Other people are
// only returned masked. A missing reward table (migration not applied) reads as "nothing yet".
import { prisma } from "@/lib/prisma";
import { REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";
import { buildWalletEntries, inferSource, maskName, summarizeBySource, type CommissionRow, type WalletEntry, type SourceTotals } from "@/lib/rewards/wallet";

const LIMIT = 200;

export interface WalletData {
  entries: WalletEntry[];
  totals: SourceTotals;
}

export async function loadWallet(userId: string): Promise<WalletData> {
  const [rebates, commissions, payouts] = await Promise.all([
    prisma.rebateInstallment.findMany({ where: { userId }, orderBy: { dueAt: "desc" }, take: LIMIT }).catch(() => []),
    prisma.referralCommission.findMany({ where: { partnerId: userId }, orderBy: { createdAt: "desc" }, take: LIMIT }).catch(() => []),
    prisma.rewardPayout.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: LIMIT }).catch(() => []),
  ]);

  const contractIds = [...new Set(rebates.map((r) => r.contractId))];
  const contracts = contractIds.length ? await prisma.rewardContract.findMany({ where: { id: { in: contractIds } }, select: { id: true, productKey: true } }).catch(() => []) : [];
  const contractNames = Object.fromEntries(contracts.map((c) => [c.id, isRewardProductKey(c.productKey) ? REWARD_PRODUCTS[c.productKey].name : "Algo Contract"]));
  const perContract = contractIds.length ? await prisma.rebateInstallment.groupBy({ by: ["contractId"], where: { contractId: { in: contractIds } }, _count: { _all: true } }).catch(() => []) : [];
  const installmentsPerContract = Object.fromEntries(perContract.map((g) => [g.contractId, g._count._all]));

  // Product purchases (not "sub:" references) tell us what was bought, who bought it and whether it was an Algo Contract.
  const purchaseIds = [...new Set(commissions.map((c) => c.purchaseId).filter((p) => !p.startsWith("sub:")))];
  const purchases = purchaseIds.length ? await prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, buyerId: true, marketplaceListingId: true } }).catch(() => []) : [];
  const contractByPurchase = purchaseIds.length ? await prisma.rewardContract.findMany({ where: { purchaseId: { in: purchaseIds } }, select: { purchaseId: true, productKey: true } }).catch(() => []) : [];
  const listings = purchases.length ? await prisma.marketplaceListing.findMany({ where: { id: { in: [...new Set(purchases.map((p) => p.marketplaceListingId))] } }, select: { id: true, title: true } }).catch(() => []) : [];

  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const contractOfPurchase = new Map(contractByPurchase.map((c) => [c.purchaseId, c.productKey]));
  const listingTitle = new Map(listings.map((l) => [l.id, l.title]));

  const buyerIds = [...new Set(commissions.map((c) => c.buyerId ?? purchaseById.get(c.purchaseId)?.buyerId).filter((x): x is string => !!x))];
  const buyers = buyerIds.length ? await prisma.user.findMany({ where: { id: { in: buyerIds } }, select: { id: true, name: true, email: true } }).catch(() => []) : [];
  const buyerName = new Map(buyers.map((u) => [u.id, maskName(u.name, u.email)]));

  const commissionRows: CommissionRow[] = commissions.map((c) => {
    const purchase = purchaseById.get(c.purchaseId);
    const contractKey = contractOfPurchase.get(c.purchaseId);
    const source = inferSource(c.purchaseId, c.source, !!contractKey);
    const detail = source === "CONTRACT"
      ? (contractKey && isRewardProductKey(contractKey) ? REWARD_PRODUCTS[contractKey].name : null)
      : source === "PRODUCT" && purchase ? (listingTitle.get(purchase.marketplaceListingId) ?? null) : null;
    const buyer = c.buyerId ?? purchase?.buyerId;
    return {
      id: c.id, purchaseRef: c.purchaseId, level: c.level, amountCents: c.amountCents, status: c.status,
      createdAt: c.createdAt, availableAt: c.availableAt, releasedAt: c.releasedAt, source, detail,
      buyerName: buyer ? (buyerName.get(buyer) ?? null) : null,
    };
  });

  const entries = buildWalletEntries({
    rebates: rebates.map((r) => ({ id: r.id, contractId: r.contractId, seq: r.seq, dueAt: r.dueAt, releasedAt: r.releasedAt, amountCents: r.amountCents, status: r.status })),
    contractNames,
    installmentsPerContract,
    commissions: commissionRows,
    payouts: payouts.map((p) => ({ id: p.id, amountCents: p.amountCents, network: p.network, status: p.status, txRef: p.txRef, createdAt: p.createdAt })),
  });
  return { entries, totals: summarizeBySource(entries) };
}
