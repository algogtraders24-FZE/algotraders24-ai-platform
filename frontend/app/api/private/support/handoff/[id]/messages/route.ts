// app/api/private/support/handoff/[id]/messages/route.ts
// AT24 Support Human Handoff MVP - D10/D11. A new user message WHILE the
// handoff is active (OPEN/ASSIGNED/IN_PROGRESS) lands here, NOT as a new
// AgentRun - the widget/hook decides which endpoint to call based on
// whether an active handoff exists for the current conversation
// (getActiveHandoffForUserConversation). Rejects (409) once terminal - the
// server-side backstop behind that client-side routing decision.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { replyAsSupportUser, HandoffNotFoundError, HandoffNotActiveError } from "@/services/support/handoff-service";
import { handoffIdFromPath } from "@/services/support/handoff-route-path";

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = handoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  if (typeof body?.content !== "string" || !body.content.trim()) {
    throw Errors.validation('A JSON body with { "content" } is required');
  }

  try {
    const handoff = await replyAsSupportUser(id, sessionUser.profile.id, body.content.trim());
    return ApiResponse.success({ handoff }, ctx.requestId, 201, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    if (err instanceof HandoffNotActiveError) {
      throw Errors.conflict("This support case is no longer active - ask a new question instead.");
    }
    throw err;
  }
});
