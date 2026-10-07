// app/api/private/live-sync/accounts/route.ts
// The signed-in user's synced MT5 accounts (status) and data deletion.
//   GET            per-account status: mode, currency, first/last sync, trades, chain head
//   DELETE ?id=... delete that account AND all its synced data (deals, batches, snapshots)
// Session-authenticated; every query is scoped to the session user's id. No
// identity exists to show: accounts are labelled by a short fingerprint of the
// salted key, never by login/name/server.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { deleteSyncedAccount } from "@/services/live-sync/prisma-store";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    const accounts = await prisma.liveSyncAccount.findMany({ where: { userId: user.profile.id }, orderBy: { lastSyncAt: "desc" }, take: 20 });
    const counts = await prisma.liveSyncDeal.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) } },
      _count: { _all: true },
    });
    const dealCount = new Map(counts.map((c) => [c.accountId, c._count._all]));
    return ApiResponse.success(
      {
        accounts: accounts.map((a) => ({
          id: a.id,
          label: `Account ${a.accountKey.slice(0, 6)}`,
          mode: a.mode,
          currency: a.currency,
          marginMode: a.marginMode,
          firstSyncAt: a.firstSyncAt,
          lastSyncAt: a.lastSyncAt,
          trades: dealCount.get(a.id) ?? 0,
          batches: a.chainSeq,
          lastBalance: a.lastBalance,
          lastEquity: a.lastEquity,
        })),
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (!(await deleteSyncedAccount(user.profile.id, id))) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
