// app/api/private/live-sync/portfolio/route.ts
// "My portfolio": all of the signed-in user's synced accounts in one table with honest totals (demo and real are never pooled,
// currencies are never added). Session-authenticated; every query is scoped to the session user's id; read-only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { loadPortfolio } from "@/services/live-sync/portfolio-load";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    const portfolio = await loadPortfolio(user.profile.id);
    const res = ApiResponse.success(portfolio, ctx.requestId, 200, ctx.startedAt);
    res.headers.set("cache-control", "private, no-store");
    return res;
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

// PATCH body {accountId, hidden:boolean}: leave an account out of (or put it back into) "My portfolio". Display only.
export const PATCH = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { accountId?: unknown; hidden?: unknown } | null;
  if (typeof body?.accountId !== "string" || !body.accountId || typeof body.hidden !== "boolean") return ApiResponse.error({ code: "BAD_REQUEST", message: "accountId and hidden are required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const res = await prisma.liveSyncAccount.updateMany({ where: { id: body.accountId, userId: user.profile.id }, data: { hiddenFromPortfolio: body.hidden } });
    if (res.count === 0) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ accountId: body.accountId, hidden: body.hidden }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Sync is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
