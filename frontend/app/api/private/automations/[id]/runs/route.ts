// app/api/private/automations/[id]/runs/route.ts
// AT24 Automation (MVP) - paginated run history for one automation.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listAutomationRuns } from "@/services/automation/run-view";
import { automationIdFromPath } from "@/services/automation/route-helpers";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("automation id is required");
  const limitRaw = Number(new URL(req.url).searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
  const items = await listAutomationRuns(sessionUser.profile.id, id, limit);
  return ApiResponse.success({ items, total: items.length }, ctx.requestId, 200, ctx.startedAt);
});
