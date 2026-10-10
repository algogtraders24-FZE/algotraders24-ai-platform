// app/api/private/live-sync/portfolio/route.ts
// "My portfolio": all of the signed-in user's synced accounts in one table with honest totals (demo and real are never pooled,
// currencies are never added). Session-authenticated; every query is scoped to the session user's id; read-only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
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
