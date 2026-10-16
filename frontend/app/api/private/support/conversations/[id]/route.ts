// app/api/private/support/conversations/[id]/route.ts
// AT24 Copilot Phase 4. GET -> one of the caller's own conversations (turns + any active ticket), so
// it can be shown and continued. Another user's id answers 404, same as an unknown id.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { getSupportConversation } from "@/services/support/conversation-history";
import { conversationIdFromPath } from "@/services/support/handoff-route-path";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = conversationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("conversation id is required");

  const conversation = await getSupportConversation(sessionUser.profile.id, id);
  if (!conversation) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Conversation not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ conversation }, ctx.requestId, 200, ctx.startedAt);
});
