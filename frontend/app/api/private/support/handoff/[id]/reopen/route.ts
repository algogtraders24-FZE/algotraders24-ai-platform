// app/api/private/support/handoff/[id]/reopen/route.ts
// AT24 Support Human Handoff MVP - Architecture Lock §18: the ONE
// transition a regular user may trigger themselves (RESOLVED -> OPEN, on
// their own handoff only). Every other transition is admin-only
// (app/api/private/admin/support-handoffs/[id]/status/route.ts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { reopenSupportHandoffAsUser, HandoffNotFoundError, InvalidTransitionError } from "@/services/support/handoff-service";
import { handoffIdFromPath } from "@/services/support/handoff-route-path";

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = handoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  try {
    const handoff = await reopenSupportHandoffAsUser(id, sessionUser.profile.id);
    return ApiResponse.success({ handoff }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    if (err instanceof InvalidTransitionError) {
      throw Errors.conflict("This support case cannot be reopened from its current status.");
    }
    throw err;
  }
});
