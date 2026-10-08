// app/api/private/live-results/export/route.ts
// The OWNER's own closed trades of one of their Live Results pages as CSV (with amounts: it is their own data).
//   GET ?pageId=...    session-authenticated; the page must belong to the signed-in user; magic filter applied
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { liveResultsEnabled, loadOwnerTrades } from "@/services/live-results/prisma-store";
import { tradesCsv } from "@/services/live-results/export";

export const dynamic = "force-dynamic";

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  const pageId = new URL(req.url).searchParams.get("pageId");
  if (!pageId || pageId.length > 60) return ApiResponse.error({ code: "BAD_REQUEST", message: "pageId is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const r = await loadOwnerTrades(user.profile.id, pageId);
    if (!r) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
    return new NextResponse(tradesCsv(r.trades), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${r.slug}-my-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
