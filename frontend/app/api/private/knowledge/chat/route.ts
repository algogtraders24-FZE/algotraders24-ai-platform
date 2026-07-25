// app/api/private/knowledge/chat/route.ts
// Sprint 15C.1 - RAG-augmented chat. Retrieves the authenticated user's own
// knowledge chunks (semantic search), injects them as context, and answers
// with Gemini + Google Search grounding.
// SECURITY: userId is always session-derived; retrieval is scoped to it so a
// user can never see another user's knowledge.
// FALLBACK: if no chunks are found, it answers normally (no RAG) so the
// assistant never breaks for users without a knowledge base.
import { GoogleGenAI } from "@google/genai";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import { AI_CONFIG } from "@/config/ai.config";

const RAG_TOP_K = 5;
const MIN_SIMILARITY = 0.3; // ignore weak matches
const MAX_CONTEXT_CHARS = 6000;

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

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return ApiResponse.error(
      { code: "CONFIG", message: "AI is not configured" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }

  const body = (await req.json().catch(() => null)) as {
    query?: unknown;
    knowledgeId?: unknown;
    useSearch?: unknown;
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
  const useSearch = body?.useSearch !== false; // default on
  const knowledgeId =
    typeof body?.knowledgeId === "string" && body.knowledgeId.trim().length > 0
      ? body.knowledgeId
      : undefined;

  // --- RAG retrieval (scoped to this user) ---
  let contextBlock = "";
  let ragApplied = false;
  let sourcesCount = 0;
  try {
    const embedder = new GeminiEmbeddingProvider();
    const embedded = await embedder.embed({ text: query });
    const hits = await RepositoryFactory.vectors().searchSimilar({
      embedding: embedded.embedding,
      topK: RAG_TOP_K,
      userId, // session-derived, never from body
      knowledgeId,
    });
    const relevant = hits.filter((h) => h.similarity >= MIN_SIMILARITY);
    if (relevant.length > 0) {
      let acc = "";
      for (const h of relevant) {
        const piece = `- ${h.content}\n`;
        if (acc.length + piece.length > MAX_CONTEXT_CHARS) break;
        acc += piece;
        sourcesCount += 1;
      }
      contextBlock = acc;
      ragApplied = sourcesCount > 0;
    }
  } catch {
    // Retrieval failure must not break chat: fall back to no-RAG.
    ragApplied = false;
  }

  // --- prompt assembly ---
  const prompt = ragApplied
    ? `Use the following context from the user's knowledge base to answer. ` +
      `If the context does not contain the answer, say so briefly and then ` +
      `answer from general knowledge.\n\nContext:\n${contextBlock}\n` +
      `Question: ${query}`
    : query;

  // --- Gemini call (RAG context + optional Google Search grounding) ---
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: AI_CONFIG.defaultModel,
      contents: prompt,
      ...(useSearch ? { config: { tools: [{ googleSearch: {} }] } } : {}),
    });
    return ApiResponse.success(
      {
        content: res.text ?? "",
        ragApplied,
        sourcesCount,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch {
    return ApiResponse.error(
      { code: "AI_FAILED", message: "The assistant could not respond" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
