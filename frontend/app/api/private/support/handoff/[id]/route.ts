// app/api/private/support/handoff/[id]/route.ts
// AT24 Support Human Handoff MVP - the caller's own handoff detail
// (status + messages), ownership-scoped. Never exposes agentRunId,
// evidenceIds, or assignedAdminUserId (§20 - no internal database IDs or
// admin identity to the end user).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getSupportHandoffForUser, HandoffNotFoundError } from "@/services/support/handoff-service";
import { handoffIdFromPath } from "@/services/support/handoff-route-path";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = handoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  try {
    const handoff = await getSupportHandoffForUser(id, sessionUser.profile.id);
    return ApiResponse.success({ handoff }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    throw err;
  }
});
