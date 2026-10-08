// services/marketplace/earningsStore.ts
// Seller self-serve Phase 4: the earnings ledger and payout requests. Pure policy lives in lib/marketplace/earnings.ts.
//   recordSaleEarning   - called INSIDE the purchase transaction (a sale can never exist without its ledger row)
//   getSellerEarnings   - the seller's own dashboard numbers
//   requestPayout       - reserves every available earning for one USDT payout request (all-or-nothing, no partial splits)
//   adminListPayouts / markPayoutPaid / rejectPayout - the only admin work: confirm a transfer was sent
//   reverseEarningForPurchase - a refunded sale stops being owed (refuses once the money was paid out)
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import { availableAtFor, computeSaleSplit, payoutBlocker, summarizeEarnings, validatePayoutAddress, cents, type EarningsSummary } from "@/lib/marketplace/earnings";

type Tx = Prisma.TransactionClient;

/** Write the ledger row for one completed purchase. No row (returns null) for the platform owner's own products. */
export async function recordSaleEarning(
  tx: Tx,
  input: { purchaseId: string; marketplaceListingId: string; amount: number; currency: string; purchasedAt: Date },
) {
  const listing = await tx.marketplaceListing.findUnique({ where: { id: input.marketplaceListingId }, select: { sellerId: true } });
  if (!listing) return null;
  const seller = await tx.user.findUnique({ where: { id: listing.sellerId }, select: { email: true } });
  if (!seller || isPlatformOwner(seller.email)) return null;
  if (!(input.amount > 0)) return null;
  const split = computeSaleSplit(input.amount);
  return tx.sellerEarning.create({
    data: {
      sellerId: listing.sellerId,
      purchaseId: input.purchaseId,
      listingId: input.marketplaceListingId,
      currency: input.currency,
      ...split,
      availableAt: availableAtFor(input.purchasedAt),
    },
  });
}

export interface SellerEarningsView {
  summary: EarningsSummary;
  sales: { id: string; listingId: string; listingTitle: string; grossAmount: number; commissionAmount: number; gatewayFee: number; netAmount: number; status: string; availableAt: string; createdAt: string }[];
  payouts: { id: string; amount: number; network: string; address: string; status: string; txRef: string | null; note: string | null; createdAt: string; decidedAt: string | null }[];
}

export async function getSellerEarnings(sellerId: string, now: Date = new Date()): Promise<SellerEarningsView> {
  const all = await prisma.sellerEarning.findMany({ where: { sellerId }, orderBy: { createdAt: "desc" } });
  const payouts = await prisma.sellerPayout.findMany({ where: { sellerId }, orderBy: { createdAt: "desc" }, take: 50 });
  const titles = new Map(
    (await prisma.marketplaceListing.findMany({ where: { id: { in: Array.from(new Set(all.map((e) => e.listingId))) } }, select: { id: true, title: true } })).map((l) => [l.id, l.title]),
  );
  return {
    summary: summarizeEarnings(all, now),
    sales: all.slice(0, 100).map((e) => ({
      id: e.id, listingId: e.listingId, listingTitle: titles.get(e.listingId) ?? "(listing)", grossAmount: e.grossAmount, commissionAmount: e.commissionAmount,
      gatewayFee: e.gatewayFee, netAmount: e.netAmount, status: e.status, availableAt: e.availableAt.toISOString(), createdAt: e.createdAt.toISOString(),
    })),
    payouts: payouts.map((p) => ({
      id: p.id, amount: p.amount, network: p.network, address: p.address, status: p.status, txRef: p.txRef, note: p.note,
      createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null,
    })),
  };
}

export type PayoutResult = { ok: true; payoutId: string; amount: number } | { ok: false; code: string; message: string };

/** Reserve ALL currently available earnings for one payout request. */
export async function requestPayout(sellerId: string, input: { network: string; address: string }, now: Date = new Date()): Promise<PayoutResult> {
  const addrErr = validatePayoutAddress(input.network, input.address);
  if (addrErr) return { ok: false, code: "BAD_ADDRESS", message: addrErr };
  return prisma.$transaction(async (tx) => {
    const open = await tx.sellerPayout.count({ where: { sellerId, status: "REQUESTED" } });
    if (open > 0) return { ok: false as const, code: "OPEN_REQUEST", message: "You already have a payout request waiting for payment." };
    const rows = await tx.sellerEarning.findMany({ where: { sellerId, status: "PENDING", payoutId: null, availableAt: { lte: now } }, orderBy: { createdAt: "asc" } });
    const total = cents(rows.reduce((s, r) => s + r.netAmount, 0));
    const blocked = payoutBlocker(total);
    if (blocked) return { ok: false as const, code: "BELOW_MINIMUM", message: blocked };
    const payout = await tx.sellerPayout.create({ data: { sellerId, amount: total, network: input.network, address: input.address.trim(), method: "USDT" } });
    // The WHERE re-states "still free", so a concurrent request cannot reserve the same earnings twice.
    const claimed = await tx.sellerEarning.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "PENDING", payoutId: null }, data: { payoutId: payout.id } });
    if (claimed.count !== rows.length) throw new Error("Earnings changed while the payout was being created - please try again.");
    return { ok: true as const, payoutId: payout.id, amount: total };
  });
}

export async function adminListPayouts(status?: string) {
  const rows = await prisma.sellerPayout.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.sellerId))) } }, select: { id: true, email: true, name: true } })).map((u) => [u.id, u]));
  return rows.map((p) => ({
    id: p.id, sellerId: p.sellerId, sellerEmail: users.get(p.sellerId)?.email ?? null, sellerName: users.get(p.sellerId)?.name ?? null,
    amount: p.amount, network: p.network, address: p.address, status: p.status, txRef: p.txRef, note: p.note,
    createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null,
  }));
}

export async function markPayoutPaid(payoutId: string, txRef: string): Promise<{ ok: boolean; code?: string }> {
  const ref = txRef.trim();
  if (ref.length < 6 || ref.length > 200) return { ok: false, code: "BAD_TX_REF" };
  return prisma.$transaction(async (tx) => {
    const p = await tx.sellerPayout.findUnique({ where: { id: payoutId } });
    if (!p) return { ok: false, code: "NOT_FOUND" };
    if (p.status !== "REQUESTED") return { ok: false, code: "NOT_OPEN" };
    await tx.sellerPayout.update({ where: { id: payoutId }, data: { status: "PAID", txRef: ref, decidedAt: new Date() } });
    await tx.sellerEarning.updateMany({ where: { payoutId, status: "PENDING" }, data: { status: "PAID" } });
    return { ok: true };
  });
}

export async function rejectPayout(payoutId: string, note: string): Promise<{ ok: boolean; code?: string }> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.sellerPayout.findUnique({ where: { id: payoutId } });
    if (!p) return { ok: false, code: "NOT_FOUND" };
    if (p.status !== "REQUESTED") return { ok: false, code: "NOT_OPEN" };
    await tx.sellerPayout.update({ where: { id: payoutId }, data: { status: "REJECTED", note: note.trim().slice(0, 300) || null, decidedAt: new Date() } });
    // The money goes back to "available"/"holding" by its own date.
    await tx.sellerEarning.updateMany({ where: { payoutId, status: "PENDING" }, data: { payoutId: null } });
    return { ok: true };
  });
}

/** A refunded sale stops being owed. Refused (needs a manual decision) once the money has been paid out. */
export async function reverseEarningForPurchase(purchaseId: string): Promise<{ ok: boolean; code?: string }> {
  const e = await prisma.sellerEarning.findUnique({ where: { purchaseId } });
  if (!e) return { ok: true, code: "NO_EARNING" };
  if (e.status === "PAID") return { ok: false, code: "ALREADY_PAID" };
  if (e.payoutId) return { ok: false, code: "IN_OPEN_PAYOUT" };
  await prisma.sellerEarning.update({ where: { id: e.id }, data: { status: "REVERSED" } });
  return { ok: true };
}
