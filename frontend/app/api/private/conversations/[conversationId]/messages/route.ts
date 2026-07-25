// app/api/private/conversations/[conversationId]/messages/route.ts
// Sprint 15C.6 - Server conversation history read-back for the assistant
// client. Sprint 15C.5 lets the client attach a serverConversationId to a
// local thread; this route lets it fetch that conversation's persisted
// messages back (e.g. after localStorage is cleared, or on a new device).
// Reuses ConversationMessageService.getMessages (15C.3/15C.4) unmodified:
// same ownership check (404, not 403, for a foreign or nonexistent
// conversation - see the service's own header comment), same chronological
// ordering, same toMessage() serialization.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { ConversationMessageService, toMessage } from "@/services/ai/conversation-message.service";
import { EntityNotFoundError, RepositoryError } from "@/types/repository";

const messageService = new ConversationMessageService();

// withContext's RouteHandler signature is (req, ctx: RequestContext) - it
// does not thread through Next's dynamic route `params` (see
// services/backend/Middleware.ts, shared by every private route and left
// untouched here). The conversation id is read instead from the already
// -parsed request path (ctx.path === RequestContext.fromRequest's
// new URL(req.url).pathname), which Next.js guarantees matches this file's
// directory structure.
function conversationIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("conversations");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }
  const userId = sessionUser.profile.id;

  const conversationId = conversationIdFromPath(ctx.path);
  if (!conversationId) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "conversationId must be a non-empty string" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  try {
    const messages = await messageService.getMessages(conversationId, userId);
    return ApiResponse.success(
      {
        conversationId,
        messages: messages.map(toMessage),
        count: messages.length,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      // 404, not 403: a conversation belonging to someone else must be
      // indistinguishable from one that does not exist.
      return ApiResponse.error(
        { code: "NOT_FOUND", message: "Conversation not found" },
        ctx.requestId,
        404,
        ctx.startedAt
      );
    }
    if (error instanceof RepositoryError) {
      return ApiResponse.error(
        { code: "VALIDATION", message: error.message },
        ctx.requestId,
        400,
        ctx.startedAt
      );
    }
    return ApiResponse.error(
      { code: "LOAD_FAILED", message: "Could not load conversation messages" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
