// app/api/private/edge-analyzer/saved/route.ts
// The signed-in user's saved Edge Analyzer analyses.
//   GET            list (id, date, trades, level) - never the report body
//   DELETE ?id=... delete one of the user's own analyses
// Session-authenticated; every query is scoped to the session user's id.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prismaEdgeSavedStore } from "@/services/edge-analyzer/prisma-saved-store";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    const rows = await prismaEdgeSavedStore.list(user.profile.id);
    return ApiResponse.success(
      { analyses: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), tradeCount: r.tradeCount, level: r.level })) },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Saved analyses are temporarily unavailable." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const deleted = await prismaEdgeSavedStore.delete(user.profile.id, id);
    if (!deleted) return ApiResponse.error({ code: "NOT_FOUND", message: "Analysis not found" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Saved analyses are temporarily unavailable." }, ctx.requestId, 503, ctx.startedAt);
  }
});
