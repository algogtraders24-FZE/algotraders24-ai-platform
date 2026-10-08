// app/api/private/live-results/directory/route.ts
// Every signed-in user: the list of PUBLIC Live Results pages (no performance numbers, no ranking).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listPublicDirectory, liveResultsEnabled } from "@/services/live-results/prisma-store";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  try {
    return ApiResponse.success({ pages: await listPublicDirectory() }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
