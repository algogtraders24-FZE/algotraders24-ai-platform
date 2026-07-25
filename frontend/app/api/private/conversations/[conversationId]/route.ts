// app/api/private/conversations/[conversationId]/route.ts
// Sprint 15C.7 - Conversation lifecycle: archive/unarchive (PATCH) and
// soft-delete (DELETE). Reuses ConversationService
// (conversation-lifecycle.service.ts), which reuses the same
// assertOwnedConversation helper as ConversationMessageService - a
// conversation belonging to someone else is indistinguishable from one that
// does not exist (404, never 403).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { ConversationService } from "@/services/ai/conversation-lifecycle.service";
import { EntityNotFoundError, RepositoryError } from "@/types/repository";

const conversationService = new ConversationService();

// withContext's RouteHandler is (req, ctx: RequestContext) - it does not
// thread through Next's dynamic route `params` (see
// services/backend/Middleware.ts, shared by every private route and left
// untouched). The conversation id is read from the already-parsed request
// path, the same technique used by the sibling
// [conversationId]/messages/route.ts (left untouched, so this is a local
// copy rather than a shared import - see that file for the original).
function conversationIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("conversations");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
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

  const body = (await req.json().catch(() => null)) as { archived?: unknown } | null;
  if (typeof body?.archived !== "boolean") {
    return ApiResponse.error(
      { code: "VALIDATION", message: "archived must be a boolean" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  try {
    if (body.archived) {
      await conversationService.archiveConversation(conversationId, userId);
    } else {
      await conversationService.unarchiveConversation(conversationId, userId);
    }
    return ApiResponse.success(
      { conversationId, archived: body.archived },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
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
      { code: "UPDATE_FAILED", message: "Could not update the conversation" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});

export const DELETE = withContext(async (_req, ctx) => {
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
    // Soft-delete only - see ConversationService.softDeleteConversation.
    await conversationService.softDeleteConversation(conversationId, userId);
    return ApiResponse.success(
      { conversationId, deleted: true },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
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
      { code: "DELETE_FAILED", message: "Could not delete the conversation" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
