// app/api/private/knowledge/[knowledgeId]/route.ts
// Delete one of the caller's own knowledge documents (soft delete: deletedAt). Its chunks stop being
// retrievable immediately - every retrieval path filters on the document's deletedAt.
// SECURITY: userId is session-derived and the document must be owned by it (else not-found, never forbidden, so ids
// of other users are not confirmable). The id is read from the request path (withContext does not thread
// Next's dynamic params - same technique as ./reindex/route.ts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";

function knowledgeIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("knowledge");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const DELETE = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const userId = sessionUser.profile.id;

  const knowledgeId = knowledgeIdFromPath(ctx.path);
  if (!knowledgeId) {
    return ApiResponse.error({ code: "VALIDATION", message: "knowledgeId is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const res = await prisma.knowledge.updateMany({
    where: { id: knowledgeId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (res.count === 0) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Document not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
});
