// app/api/private/live-sync/live/route.ts
// Live panel data for one synced account.
//   GET ?accountId=...  -> latest snapshot (balance/equity/margin, open positions),
//                          equity series (last ~24 h), today's closed P&L, exposure summary
// Session-authenticated; the account must belong to the session user. Read-only.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { summarizeLive, type SnapshotRow } from "@/services/live-sync/live-summary";

export const dynamic = "force-dynamic";

const SERIES_HOURS = 24;
const SERIES_MAX = 400;

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return ApiResponse.error({ code: "BAD_REQUEST", message: "accountId is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const account = await prisma.liveSyncAccount.findFirst({ where: { id: accountId, userId: user.profile.id } });
    if (!account) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);

    const since = new Date(Date.now() - SERIES_HOURS * 3600_000);
    const snaps = await prisma.liveSyncSnapshot.findMany({
      where: { accountId: account.id, timeUtc: { gte: since } },
      orderBy: { timeUtc: "desc" },
      take: SERIES_MAX,
      select: { timeUtc: true, balance: true, equity: true, margin: true, freeMargin: true, positions: true },
    });
    const rows: SnapshotRow[] = snaps.reverse().map((s) => ({
      time: s.timeUtc.getTime(),
      balance: s.balance,
      equity: s.equity,
      margin: s.margin,
      freeMargin: s.freeMargin,
      positions: Array.isArray(s.positions) ? (s.positions as unknown as SnapshotRow["positions"]) : [],
    }));
    const live = summarizeLive(rows, Date.now());
    return ApiResponse.success(
      { accountId: account.id, mode: account.mode, currency: account.currency, lastSyncAt: account.lastSyncAt, ...live },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
