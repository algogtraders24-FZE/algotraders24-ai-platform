// app/api/private/knowledge/search/route.ts
// Sprint 15B.8 - Semantic (vector) search over the authenticated user's
// knowledge chunks. Embeds the query, then cosine-searches pgvector.
// SECURITY: results are ALWAYS scoped to the session user's id; the userId
// is taken from the verified session and never from the request body.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import { AIProviderError } from "@/lib/ai";

const MAX_TOP_K = 20;
const DEFAULT_TOP_K = 5;

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

  const body = (await req.json().catch(() => null)) as {
    query?: unknown;
    topK?: unknown;
    knowledgeId?: unknown;
  } | null;

  const query = body?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "query must be a non-empty string" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }

  let topK = DEFAULT_TOP_K;
  if (body?.topK !== undefined) {
    if (
      typeof body.topK !== "number" ||
      !Number.isInteger(body.topK) ||
      body.topK < 1
    ) {
      return ApiResponse.error(
        { code: "VALIDATION", message: "topK must be a positive integer" },
        ctx.requestId,
        400,
        ctx.startedAt
      );
    }
    topK = Math.min(body.topK, MAX_TOP_K);
  }

  let knowledgeId: string | undefined;
  if (body?.knowledgeId !== undefined) {
    if (typeof body.knowledgeId !== "string" || body.knowledgeId.trim().length === 0) {
      return ApiResponse.error(
        { code: "VALIDATION", message: "knowledgeId must be a non-empty string" },
        ctx.requestId,
        400,
        ctx.startedAt
      );
    }
    knowledgeId = body.knowledgeId;
  }

  try {
    // Embed the query, then cosine-search — scoped to THIS user's chunks.
    const embedder = new GeminiEmbeddingProvider();
    const embedded = await embedder.embed({ text: query });

    const results = await RepositoryFactory.vectors().searchSimilar({
      embedding: embedded.embedding,
      topK,
      userId: sessionUser.profile.id, // session-derived, never from body
      knowledgeId,
    });

    return ApiResponse.success(
      {
        results: results.map((r) => ({
          chunkId: r.chunkId,
          knowledgeId: r.knowledgeId,
          content: r.content,
          chunkIndex: r.chunkIndex,
          similarity: r.similarity,
        })),
        total: results.length,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch (error) {
    // Embedding-provider failures and vector-search failures both surface as
    // a server-side error; the specific kind is logged, not exposed.
    const code =
      error instanceof AIProviderError ? "EMBEDDING_FAILED" : "SEARCH_FAILED";
    return ApiResponse.error(
      { code, message: "Search could not be completed" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
