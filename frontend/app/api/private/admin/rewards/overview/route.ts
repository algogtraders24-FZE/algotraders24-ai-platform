// app/api/private/admin/rewards/overview/route.ts
// Admin: GET ?month=YYYY-MM -> everything the Algo Contracts admin page shows: slots, reserve vs owed, contracts, open withdrawals,
// and checkouts whose fulfilment failed after a confirmed payment. Read-only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { ALL_REWARD_PRODUCT_KEYS, REWARD_PRODUCTS } from "@/lib/rewards/config";
import { reserveShortfall, summarizeReserve } from "@/lib/rewards/ledger";
import { isMonthKey, monthKey } from "@/lib/rewards/slots";
import { slotSummary } from "@/services/rewards/slotStore";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const q = new URL(req.url).searchParams.get("month");
  const month = isMonthKey(q) ? q : monthKey(new Date());

  const [slots, reserveRows, owed, contracts, payouts, failed, enabledRows] = await Promise.all([
    slotSummary(month),
    prisma.rewardReserveEntry.findMany({ select: { type: true, amountCents: true } }),
    prisma.rebateInstallment.aggregate({ where: { status: { in: ["SCHEDULED", "FROZEN"] } }, _sum: { amountCents: true } }),
    prisma.rewardContract.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.rewardPayout.findMany({ where: { status: "REQUESTED" }, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.rewardCheckout.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.rewardProduct.findMany({ select: { key: true, enabled: true, listingId: true } }),
  ]);
  const reserve = summarizeReserve(reserveRows.map((r) => ({ type: r.type as "RESERVED" | "RELEASED" | "RETURNED", amountCents: r.amountCents })));
  const owedCents = owed._sum.amountCents ?? 0;

  const userIds = [...new Set([...contracts.map((c) => c.userId), ...payouts.map((p) => p.userId)])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
  const email = new Map(users.map((u) => [u.id, u.email]));

  return ApiResponse.success(
    {
      month,
      products: ALL_REWARD_PRODUCT_KEYS.map((k) => ({
        key: k,
        name: REWARD_PRODUCTS[k].name,
        listPriceCents: REWARD_PRODUCTS[k].listPriceCents,
        enabled: enabledRows.find((r) => r.key === k)?.enabled ?? false,
        listingId: enabledRows.find((r) => r.key === k)?.listingId ?? null,
        slot: slots.byProduct[k] ?? null,
      })),
      reserve: { ...reserve, owedCents, shortfallCents: reserveShortfall(owedCents, reserve.outstanding), balanced: reserve.outstanding === owedCents },
      contracts: contracts.map((c) => ({ id: c.id, email: email.get(c.userId) ?? c.userId, productKey: c.productKey, status: c.status, listPriceCents: c.listPriceCents, rebateTotalCents: c.rebateTotalCents, startsAt: c.startsAt, endsAt: c.endsAt })),
      payouts: payouts.map((p) => ({ id: p.id, email: email.get(p.userId) ?? p.userId, amountCents: p.amountCents, network: p.network, address: p.address, createdAt: p.createdAt })),
      failedCheckouts: failed.map((f) => ({ id: f.id, intentId: f.intentId, userId: f.userId, productKey: f.productKey, error: f.error, createdAt: f.createdAt })),
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
