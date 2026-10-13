// app/api/private/admin/wallet/route.ts
// Admin: GET ?days=30 (1-90) -> the Wallet page: daily money in / out, open withdrawals (members + sellers), recent payments received,
// referral commissions and top partners, reserve vs owed. Read-only. Days are IST.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { reserveShortfall, summarizeReserve } from "@/lib/rewards/ledger";
import { buildDaily, dollarsToCents, istDayStart, lastDays, sumDaily } from "@/lib/rewards/adminWallet";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = lastDays(Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 30);
  const since = istDayStart(days[0]);

  const [purchases, memberPayouts, sellerPayouts, commissions, rebates, reserveRows, owed] = await Promise.all([
    prisma.purchase.findMany({ where: { deletedAt: null, updatedAt: { gte: since }, status: { in: ["COMPLETED", "REFUNDED", "REVERSED"] } }, orderBy: { purchasedAt: "desc" }, take: 1000 }),
    prisma.rewardPayout.findMany({ where: { OR: [{ status: "REQUESTED" }, { createdAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.sellerPayout.findMany({ where: { OR: [{ status: "REQUESTED" }, { createdAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.referralCommission.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 2000 }),
    prisma.rebateInstallment.findMany({ where: { status: { in: ["RELEASED", "PAID"] }, releasedAt: { gte: since } }, select: { releasedAt: true, amountCents: true } }),
    prisma.rewardReserveEntry.findMany({ select: { type: true, amountCents: true } }),
    prisma.rebateInstallment.aggregate({ where: { status: { in: ["SCHEDULED", "FROZEN"] } }, _sum: { amountCents: true } }),
  ]);

  const paidPurchases = purchases.filter((p) => p.status === "COMPLETED" && p.amount > 0 && p.purchasedAt >= since);
  const gone = purchases.filter((p) => p.status !== "COMPLETED" && p.amount > 0);
  const liveCommissions = commissions.filter((c) => c.status !== "CANCELLED" && c.status !== "REVERSED");
  const withdrawals = [
    ...memberPayouts.map((p) => ({ kind: "Member" as const, id: p.id, userId: p.userId, amountCents: p.amountCents, network: p.network, address: p.address, status: p.status, txRef: p.txRef, note: p.note, createdAt: p.createdAt, decidedAt: p.decidedAt })),
    ...sellerPayouts.map((p) => ({ kind: "Seller" as const, id: p.id, userId: p.sellerId, amountCents: dollarsToCents(p.amount), network: p.network, address: p.address, status: p.status, txRef: p.txRef, note: p.note, createdAt: p.createdAt, decidedAt: p.decidedAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const daily = buildDaily(days, {
    deposits: paidPurchases.map((p) => ({ at: p.purchasedAt, amountCents: dollarsToCents(p.amount) })),
    refunds: gone.map((p) => ({ at: p.updatedAt, amountCents: dollarsToCents(p.amount) })),
    withdrawals: withdrawals.map((w) => ({ requestedAt: w.createdAt, paidAt: w.status === "PAID" ? w.decidedAt : null, amountCents: w.amountCents })),
    commissions: liveCommissions.map((c) => ({ at: c.createdAt, amountCents: c.amountCents })),
    rebates: rebates.filter((r) => r.releasedAt).map((r) => ({ at: r.releasedAt as Date, amountCents: r.amountCents })),
  });

  const userIds = [...new Set([...withdrawals.map((w) => w.userId), ...paidPurchases.map((p) => p.buyerId), ...liveCommissions.flatMap((c) => [c.partnerId, c.buyerId ?? ""]).filter(Boolean)])];
  const [users, contracts, listings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    prisma.rewardContract.findMany({ where: { purchaseId: { in: paidPurchases.map((p) => p.id) } }, select: { purchaseId: true, productKey: true } }),
    prisma.marketplaceListing.findMany({ where: { id: { in: [...new Set(paidPurchases.map((p) => p.marketplaceListingId))] } }, select: { id: true, title: true } }),
  ]);
  const email = new Map(users.map((u) => [u.id, u.email]));
  const contractOf = new Map(contracts.map((c) => [c.purchaseId, c.productKey]));
  const title = new Map(listings.map((l) => [l.id, l.title]));

  const byPartner = new Map<string, { cents: number; count: number }>();
  for (const c of liveCommissions) {
    const cur = byPartner.get(c.partnerId) ?? { cents: 0, count: 0 };
    cur.cents += c.amountCents;
    cur.count++;
    byPartner.set(c.partnerId, cur);
  }
  const reserve = summarizeReserve(reserveRows.map((r) => ({ type: r.type as "RESERVED" | "RELEASED" | "RETURNED", amountCents: r.amountCents })));
  const owedCents = owed._sum.amountCents ?? 0;
  const open = withdrawals.filter((w) => w.status === "REQUESTED");

  return ApiResponse.success(
    {
      timezone: "IST (UTC+5:30)",
      days,
      daily,
      totals: sumDaily(daily),
      open: { count: open.length, cents: open.reduce((s, w) => s + w.amountCents, 0) },
      reserve: { ...reserve, owedCents, shortfallCents: reserveShortfall(owedCents, reserve.outstanding), balanced: reserve.outstanding === owedCents },
      withdrawals: withdrawals.slice(0, 200).map((w) => ({ ...w, email: email.get(w.userId) ?? w.userId })),
      deposits: paidPurchases.slice(0, 200).map((p) => ({ id: p.id, at: p.purchasedAt, email: email.get(p.buyerId) ?? p.buyerId, amountCents: dollarsToCents(p.amount), provider: p.provider, providerRef: p.providerRef, what: contractOf.has(p.id) ? `Algo Contract (${contractOf.get(p.id)})` : title.get(p.marketplaceListingId) ?? "Marketplace purchase" })),
      commissions: liveCommissions.slice(0, 200).map((c) => ({ id: c.id, at: c.createdAt, partner: email.get(c.partnerId) ?? c.partnerId, buyer: c.buyerId ? email.get(c.buyerId) ?? c.buyerId : null, level: c.level, source: c.source, status: c.status, amountCents: c.amountCents })),
      topPartners: [...byPartner.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 10).map(([id, v]) => ({ partner: email.get(id) ?? id, cents: v.cents, count: v.count })),
      notes: ["Pro subscription payments are not stored as payment rows, so they are not in money in. Only completed marketplace and Algo Contract purchases are."],
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
