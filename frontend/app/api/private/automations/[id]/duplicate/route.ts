// app/api/private/automations/[id]/duplicate/route.ts
// AT24 Automation (MVP) - copy an automation's active definition into a new
// DRAFT (subject to the plan limit).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationService } from "@/services/automation/automation-service";
import { automationIdFromPath } from "@/services/automation/route-helpers";

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("automation id is required");
  const result = await automationService.duplicate(sessionUser.profile.id, id);
  return ApiResponse.success(result, ctx.requestId, 201, ctx.startedAt);
});
