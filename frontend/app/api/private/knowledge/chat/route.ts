// app/api/private/knowledge/chat/route.ts
// Sprint 15C.1 - RAG-augmented chat. Retrieves the authenticated user's own
// knowledge chunks (semantic search), injects them as context, and answers
// with Gemini + Google Search grounding.
// Sprint 15C.4 - Live conversation orchestration. The user's turn and the
// assistant's turn are now persisted server-side (ConversationMessageService,
// Sprint 15C.3) and the AI request context is assembled deterministically by
// the Context Manager (Sprint 15C.2) instead of one hand-built prompt
// string. Generation still calls GoogleGenAI directly, not lib/ai's
// AIService/GeminiProvider: GeminiProvider has no Google Search tool
// support yet (see app/api/ai/route.ts's RECONCILE comment) and this route
// requires search grounding - the same, already-established exception.
// SECURITY: userId is always session-derived; retrieval and persistence are
// scoped to it so a user can never read or write another user's data.
// FALLBACK: if no chunks are found, it answers normally (no RAG) so the
// assistant never breaks for users without a knowledge base.
import { GoogleGenAI } from "@google/genai";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import { AI_CONFIG } from "@/config/ai.config";
import { ConversationMessageService, toMessage } from "@/services/ai/conversation-message.service";
import { buildContext } from "@/services/ai/context-manager.service";
import type { Message } from "@/types/message";
import { EntityNotFoundError, RepositoryError } from "@/types/repository";

const RAG_TOP_K = 5;
const MIN_SIMILARITY = 0.3; // ignore weak matches
const MAX_CONTEXT_CHARS = 6000;
const MAX_TITLE_LENGTH = 60;
const RAG_SYSTEM_INSTRUCTIONS =
  "Use the following context from the user's knowledge base to answer. " +
  "If the context does not contain the answer, say so briefly and then " +
  "answer from general knowledge.";

const messageService = new ConversationMessageService();

// Gemini's chat format has no "system" turn in `contents`; Context Manager
// system-role output is passed separately via config.systemInstruction
// instead (see below). Kept local rather than reusing
// GeminiProvider.toGeminiContents: that method is private to a provider
// that does not support the Google Search tool this route depends on.
function toGeminiContents(messages: Message[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

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
    conversationId?: unknown;
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

  if (body?.conversationId !== undefined && typeof body.conversationId !== "string") {
    return ApiResponse.error(
      { code: "VALIDATION", message: "conversationId must be a string" },
      ctx.requestId,
      400,
      ctx.startedAt
    );
  }
  const requestedConversationId =
    typeof body?.conversationId === "string" && body.conversationId.trim().length > 0
      ? body.conversationId
      : undefined;

  // --- Conversation identity (Sprint 15C.4) ---
  // A supplied id must already belong to this user (enforced below when the
  // turn is persisted). The current dashboard client does not send one yet
  // (chat history still lives in localStorage - see
  // services/ai/conversation-manager.service.ts), so omitting it is normal:
  // a fresh server-side conversation is created per request rather than
  // breaking or gating the existing chat flow.
  let conversationId: string;
  if (requestedConversationId) {
    conversationId = requestedConversationId;
  } else {
    try {
      const created = await RepositoryFactory.conversations().create({
        userId,
        title: query.slice(0, MAX_TITLE_LENGTH),
        messageCount: 0,
        lastMessageAt: new Date().toISOString(),
      });
      conversationId = created.id;
    } catch {
      return ApiResponse.error(
        { code: "CONVERSATION_FAILED", message: "Could not start a new conversation" },
        ctx.requestId,
        500,
        ctx.startedAt
      );
    }
  }

  // --- Persist the user's turn, then load chronological history ---
  // Ownership is verified inside ConversationMessageService (a conversation
  // that exists but belongs to someone else is reported as NOT_FOUND, never
  // a distinct "forbidden" - see the service's own header comment).
  let history: Message[];
  try {
    await messageService.addUserMessage(conversationId, userId, query);
    const persisted = await messageService.getMessages(conversationId, userId);
    history = persisted.map(toMessage);
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
      { code: "PERSISTENCE_FAILED", message: "Could not save your message" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }

  // `history` ends with the message just persisted above. The Context
  // Manager keeps "prior turns" and "the current turn" as distinct inputs
  // (the current message is always placed last, deterministically), so
  // split it back apart here rather than passing it twice.
  const currentMessage = history[history.length - 1];
  const recentMessages = history.slice(0, -1);

  // --- RAG retrieval (scoped to this user) - unchanged from Sprint 15C.1 ---
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

  // --- Deterministic context assembly (Sprint 15C.2 Context Manager) ---
  // Live search context is intentionally left unset: Google Search grounding
  // happens inline inside the Gemini call below (config.tools), not as a
  // separately fetched text block, so there is nothing to hand the Context
  // Manager for that slot. Google Search behavior is otherwise unchanged.
  const aiContext = buildContext({
    systemInstructions: ragApplied ? RAG_SYSTEM_INSTRUCTIONS : undefined,
    ragContext: ragApplied ? contextBlock : undefined,
    recentMessages,
    userMessage: currentMessage,
  });

  const systemInstructionText = aiContext.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const geminiContents = toGeminiContents(aiContext.messages);

  // --- Gemini call (deterministic context + optional Google Search grounding) ---
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: AI_CONFIG.defaultModel,
      contents: geminiContents,
      config: {
        ...(systemInstructionText ? { systemInstruction: systemInstructionText } : {}),
        ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });
    const answer = res.text ?? "";

    // Persist the assistant's turn. Best-effort: a failure here must not
    // fail the response (the user already has their answer) or invent a
    // placeholder message - it simply won't appear in future history.
    if (answer.trim().length > 0) {
      try {
        await messageService.addAssistantMessage(conversationId, userId, answer);
      } catch {
        // Non-fatal - see comment above.
      }
    }

    return ApiResponse.success(
      {
        content: answer,
        ragApplied,
        sourcesCount,
        conversationId,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  } catch {
    // AI generation failed: the user's turn persisted above is preserved
    // (never rolled back) and no assistant message is written.
    return ApiResponse.error(
      { code: "AI_FAILED", message: "The assistant could not respond" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }
});
