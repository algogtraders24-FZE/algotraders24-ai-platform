// app/api/private/automations/[id]/run/route.ts
// AT24 Automation (MVP) - "Run now". Creates a manual AutomationRun and
// drives it (bounded by maxDuration); the client then polls the run detail
// / advance for a long run.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { triggerManualRun } from "@/services/automation/run-dispatch";
import { automationIdFromPath } from "@/services/automation/route-helpers";

export const maxDuration = 60;

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("automation id is required");
  const result = await triggerManualRun(sessionUser.profile.id, id);
  return ApiResponse.success(result, ctx.requestId, 202, ctx.startedAt);
});
