// app/api/private/support/conversations/route.ts
// AT24 Copilot Phase 4. GET -> the caller's own recent Copilot conversations (newest first).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listSupportConversations } from "@/services/support/conversation-history";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const conversations = await listSupportConversations(sessionUser.profile.id);
  return ApiResponse.success({ conversations }, ctx.requestId, 200, ctx.startedAt);
});
