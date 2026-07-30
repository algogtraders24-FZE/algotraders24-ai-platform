// app/api/private/knowledge/[knowledgeId]/reindex/route.ts
// Sprint L2.2 - Real re-index. Replaces the previous fake "Re-index"
// button (services/knowledge/KnowledgeIndexer.ts's indexDocument(), whose
// own comment called it a simulation). Re-embeds the document's existing,
// already-correct chunks via IngestionService.reembed() - no re-parsing,
// no duplicated embedding logic.
// SECURITY: knowledgeId ownership verified before touching anything.
// withContext's RouteHandler is (req, ctx: RequestContext) - it does not
// thread through Next's dynamic route `params` (see
// services/backend/Middleware.ts, shared by every private route and left
// untouched). The id is read from the already-parsed request path, the
// same technique used by app/api/private/conversations/[conversationId]/route.ts.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { IngestionService } from "@/services/knowledge/IngestionService";

function knowledgeIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("knowledge");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const userId = sessionUser.profile.id;

  const knowledgeId = knowledgeIdFromPath(ctx.path);
  if (!knowledgeId) {
    return ApiResponse.error({ code: "VALIDATION", message: "knowledgeId is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const owned = await prisma.knowledge.findFirst({
    where: { id: knowledgeId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Knowledge document not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  await prisma.knowledge.update({ where: { id: knowledgeId }, data: { status: "processing", embeddingStatus: "processing" } });

  try {
    const service = new IngestionService();
    const result = await service.reembed(knowledgeId);

    const indexed = result.embeddingsStored > 0;
    const finalStatus = result.chunksCreated === 0 || !indexed ? "failed" : "indexed";
    const updated = await prisma.knowledge.update({
      where: { id: knowledgeId },
      data: {
        status: finalStatus,
        embeddingStatus: finalStatus === "indexed" ? "embedded" : "failed",
        lastIndexed: indexed ? new Date() : null,
      },
    });

    return ApiResponse.success(
      {
        status: updated.status,
        embeddingStatus: updated.embeddingStatus,
        lastIndexed: updated.lastIndexed ? updated.lastIndexed.toISOString() : null,
        chunksCreated: result.chunksCreated,
        embeddingsStored: result.embeddingsStored,
        embeddingsFailed: result.embeddingsFailed,
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    await prisma.knowledge.update({ where: { id: knowledgeId }, data: { status: "failed", embeddingStatus: "failed" } }).catch(() => {});
    return ApiResponse.error({ code: "REINDEX_FAILED", message: "Re-indexing could not be completed" }, ctx.requestId, 500, ctx.startedAt);
  }
});
