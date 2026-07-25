// app/api/private/knowledge/ingest/route.ts
// Sprint 15B.9 - Ingest a document's text into the RAG pipeline:
// chunk -> embed -> store vectors, for the authenticated user's own document.
// SECURITY:
//  - userId is taken from the verified session, never from the body.
//  - The target knowledgeId MUST belong to the session user (ownership check);
//    otherwise 404, so a user cannot ingest into someone else's document.
//  - text length is capped to bound embedding cost / request time.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { IngestionService } from "@/services/knowledge/IngestionService";
import { AIProviderError } from "@/lib/ai";

const MAX_TEXT_LENGTH = 100_000; // ~100 KB; bounds chunk count / embedding cost

export const POST = withContext(async (req, ctx) => {
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

  const body = (await req.json().catch(() => null)) as {
    knowledgeId?: unknown;
    text?: unknown;
    chunkOptions?: { chunkSize?: number; overlap?: number };
  } | null;

  const knowledgeId = body?.knowledgeId;
  if (typeof knowledgeId !== "string" || knowledgeId.trim().length === 0) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "knowledgeId must be a non-empty string" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  const text = body?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "text must be a non-empty string" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return ApiResponse.error(
      {
        code: "VALIDATION",
        message: `text exceeds the maximum length of ${MAX_TEXT_LENGTH} characters`,
      },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  // OWNERSHIP: the document must exist AND belong to this user.
  const owned = await prisma.knowledge.findFirst({
    where: { id: knowledgeId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    // 404 (not 403) so we do not reveal whether the id exists for another user.
    return ApiResponse.error(
      { code: "NOT_FOUND", message: "Knowledge document not found" },
      ctx.requestId,
      404,
      ctx.startedAt
    );
  }

  try {
    const service = new IngestionService();
    const result = await service.ingest({
      knowledgeId,
      userId, // session-derived
      text,
      chunkOptions: body?.chunkOptions,
    });

    return ApiResponse.success(
      {
        knowledgeId: result.knowledgeId,
        chunksCreated: result.chunksCreated,
        embeddingsStored: result.embeddingsStored,
        embeddingsFailed: result.embeddingsFailed,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch (error) {
    const code =
      error instanceof AIProviderError ? "EMBEDDING_FAILED" : "INGEST_FAILED";
    return ApiResponse.error(
      { code, message: "Ingestion could not be completed" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
