// app/api/private/support/handoff/route.ts
// AT24 Support Human Handoff MVP - the user-facing entry point.
//
//   GET  ?conversationId=... -> the caller's own ACTIVE handoff for that
//        conversation, or null (a normal, expected result - not an error).
//        Lets the widget decide whether to switch into "handed to support"
//        mode.
//   POST { conversationId } -> "Talk to a human" (USER_REQUEST trigger,
//        SUPPORT_HUMAN_HANDOFF_ARCHITECTURE_LOCK.md D2). Creates or reuses
//        the conversation's active handoff (D1) - never a second ticket
//        system, never an external provider.
//
// LOCKED (same discipline as every other Support route in this program):
// userId always comes from the server session, never the request body.
// agentRunId is NEVER accepted from the client (§18) - handoff-service.ts
// resolves it server-side from the conversation's own real AgentRun rows.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import {
  ensureSupportHandoff,
  getActiveHandoffForUserConversation,
  USER_REQUEST_REASON,
  NoConversationRunsError,
} from "@/services/support/handoff-service";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    throw Errors.validation("conversationId query parameter is required");
  }

  const handoff = await getActiveHandoffForUserConversation(sessionUser.profile.id, conversationId);
  return ApiResponse.success({ handoff }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { conversationId?: unknown } | null;
  if (typeof body?.conversationId !== "string" || !body.conversationId.trim()) {
    throw Errors.validation('A JSON body with { "conversationId" } is required');
  }

  try {
    const handoff = await ensureSupportHandoff({
      userId: sessionUser.profile.id,
      conversationId: body.conversationId,
      triggerSource: "USER_REQUEST",
      reason: USER_REQUEST_REASON,
    });
    return ApiResponse.success(
      { handoffId: handoff.id, status: handoff.status },
      ctx.requestId,
      handoff.status === "OPEN" ? 201 : 200,
      ctx.startedAt,
    );
  } catch (err) {
    if (err instanceof NoConversationRunsError) {
      throw Errors.validation("This conversation has no messages yet - ask a question first.");
    }
    throw err;
  }
});
