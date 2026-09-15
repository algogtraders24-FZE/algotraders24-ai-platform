// app/api/private/automation-runs/[id]/cancel/route.ts
// AT24 Automation (MVP) - request cooperative cancellation of a run. The
// dispatcher observes cancelRequestedAt between steps.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { requestRunCancellation } from "@/services/automation/run-dispatch";
import { automationRunIdFromPath } from "@/services/automation/route-helpers";

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationRunIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");
  const result = await requestRunCancellation(sessionUser.profile.id, id);
  return ApiResponse.success({ ...result, cancelRequested: true }, ctx.requestId, 200, ctx.startedAt);
});
