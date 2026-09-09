// app/api/private/automation-runs/[id]/route.ts
// AT24 Automation (MVP) - Run Detail (AUTOMATION_API_CONTRACT.md §3). Non-
// owner -> 404. Failed steps are always present in `steps`.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getRunDetail } from "@/services/automation/run-view";
import { automationRunIdFromPath } from "@/services/automation/route-helpers";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationRunIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");
  const run = await getRunDetail(sessionUser.profile.id, id);
  return ApiResponse.success({ run }, ctx.requestId, 200, ctx.startedAt);
});
