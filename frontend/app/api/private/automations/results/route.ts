// app/api/private/automations/results/route.ts
// AT24 Automation Phase 2 - the caller's latest automation results (what their
// automations actually concluded). Session-scoped; userId is never read from
// the request.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getLatestResults } from "@/services/automation/results";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 50) : 20;
  const items = await getLatestResults(sessionUser.profile.id, limit);
  return ApiResponse.success({ items, total: items.length }, ctx.requestId, 200, ctx.startedAt);
});
