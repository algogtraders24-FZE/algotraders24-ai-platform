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
//
// Sprint L2.4 - Two changes, everything above stays true:
// 1. Streaming: generateContent -> generateContentStream. The response is
//    now a newline-delimited JSON stream ({"type":"token",...} chunks, one
//    final {"type":"done",...} with sources/conversationId, or
//    {"type":"error",...}) instead of one blocking JSON envelope. RAG
//    retrieval and conversation persistence are unchanged in substance -
//    the user's turn is still persisted before generation starts, the
//    assistant's turn is still persisted after, just from inside the
//    stream's completion step instead of before returning a single response.
// 2. Sources: relevant hits' real document titles are now looked up and
//    returned in the final event (not just sourcesCount), so the UI has
//    something real to show in a Sources panel.
// Zero new imports from any Sprint 15D file - this route's decoupling from
// the Market Intelligence pipeline (asserted by every 15D validation
// script) is unchanged.
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import { AI_CONFIG } from "@/config/ai.config";
import { ConversationMessageService, toMessage } from "@/services/ai/conversation-message.service";
import { buildContext } from "@/services/ai/context-manager.service";
import { AI_COMMUNICATION_POLICY } from "@/lib/ai/response-policy";
import { prisma } from "@/lib/prisma";
import type { Message } from "@/types/message";
import { EntityNotFoundError, RepositoryError } from "@/types/repository";
import { analyticsEventService } from "@/services/analytics/AnalyticsEventService";

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

interface ChatSource {
  knowledgeId: string;
  title: string;
  chunkId: string;
  chunkIndex: number;
  similarity: number;
  snippet: string;
}

const encoder = new TextEncoder();
function ndjson(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
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
    stream?: unknown;
  } | null;

  // Sprint L2.4 - opt-in only. Default (stream !== true) reproduces the
  // exact pre-L2.4 blocking JSON response, byte for byte - the publishing,
  // trading-copilot, and agents callers (services/ai/assistant.service.ts's
  // existing sendMessage()) never set this and must keep working
  // unmodified. Only the dashboard Assistant page's new streaming call
  // sets stream: true.
  const wantsStream = body?.stream === true;

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

  const currentMessage = history[history.length - 1];
  const recentMessages = history.slice(0, -1);

  // --- RAG retrieval (scoped to this user) - unchanged from Sprint 15C.1 ---
  let contextBlock = "";
  let ragApplied = false;
  let sources: ChatSource[] = [];
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
      const kept: typeof relevant = [];
      for (const h of relevant) {
        const piece = `- ${h.content}\n`;
        if (acc.length + piece.length > MAX_CONTEXT_CHARS) break;
        acc += piece;
        kept.push(h);
      }
      contextBlock = acc;
      ragApplied = kept.length > 0;

      if (kept.length > 0) {
        // Sprint L2.4 - real document titles for the sources panel, not
        // just a count. Best-effort: if the title lookup fails, sources
        // are omitted (never fabricated), ragApplied/context still stand.
        try {
          const docs = await prisma.knowledge.findMany({
            where: { id: { in: [...new Set(kept.map((h) => h.knowledgeId))] } },
            select: { id: true, title: true },
          });
          const titleById = new Map(docs.map((d) => [d.id, d.title]));
          sources = kept.map((h) => ({
            knowledgeId: h.knowledgeId,
            title: titleById.get(h.knowledgeId) ?? "Untitled document",
            chunkId: h.chunkId,
            chunkIndex: h.chunkIndex,
            similarity: h.similarity,
            snippet: h.content.length > 180 ? `${h.content.slice(0, 180)}…` : h.content,
          }));
        } catch {
          sources = [];
        }
      }
    }
  } catch {
    // Retrieval failure must not break chat: fall back to no-RAG.
    ragApplied = false;
  }

  // --- Deterministic context assembly (Sprint 15C.2 Context Manager) ---
  // Sprint D2.3.S4 - the communication policy is now always-on: previously
  // this route only sent a system instruction when RAG hits were found, so
  // most chat turns (any question with no matching knowledge chunk) had zero
  // wording policy applied. RAG_SYSTEM_INSTRUCTIONS still layers on top only
  // when RAG actually applies.
  const systemInstructions = ragApplied
    ? `${AI_COMMUNICATION_POLICY}\n\n${RAG_SYSTEM_INSTRUCTIONS}`
    : AI_COMMUNICATION_POLICY;
  const aiContext = buildContext({
    systemInstructions,
    ragContext: ragApplied ? contextBlock : undefined,
    recentMessages,
    userMessage: currentMessage,
  });

  const systemInstructionText = aiContext.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const geminiContents = toGeminiContents(aiContext.messages);

  // --- Gemini call ---
  // Sprint L2.4 - both branches below call the SAME generateContentStream:
  // internally, Gemini's own SDK doesn't distinguish "give me it all at
  // once" from "give me chunks" as separate calls, so there's exactly one
  // code path that talks to Gemini, not two. The difference is only in
  // what this route does with the chunks afterward - await and join them
  // (non-streaming, backward compatible) or forward each one immediately
  // (streaming, the new opt-in behavior).
  const ai = new GoogleGenAI({ apiKey: key });
  const generationConfig = {
    model: AI_CONFIG.defaultModel,
    contents: geminiContents,
    config: {
      ...(systemInstructionText ? { systemInstruction: systemInstructionText } : {}),
      ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  };

  if (!wantsStream) {
    // --- Pre-L2.4 behavior, unchanged: one blocking JSON response. ---
    try {
      const geminiStream = await ai.models.generateContentStream(generationConfig);
      let answer = "";
      for await (const chunk of geminiStream) {
        answer += chunk.text ?? "";
      }

      if (answer.trim().length > 0) {
        try {
          await messageService.addAssistantMessage(conversationId, userId, answer);
        } catch {
          // Non-fatal - see the streaming branch's identical comment.
        }
      }

      // Sprint R1.2 - Phase 2: real "ai_chat" event, additive, best-effort.
      await analyticsEventService.record(userId, "ai_chat").catch(() => {});

      return ApiResponse.success(
        {
          content: answer,
          ragApplied,
          sourcesCount: sources.length,
          sources,
          conversationId,
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
  }

  // --- Streaming (opt-in via {stream: true}) ---
  let geminiStream: AsyncGenerator<{ text?: string }>;
  try {
    geminiStream = await ai.models.generateContentStream(generationConfig);
  } catch {
    // AI generation failed before any token was produced: the user's turn
    // persisted above is preserved (never rolled back), no assistant
    // message is written. Same failure semantics as the non-streaming path.
    return ApiResponse.error(
      { code: "AI_FAILED", message: "The assistant could not respond" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }

  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      try {
        // Sprint D2.3.S2 - a real, honestly-timed progress signal (Master
        // Audit D2.3.F: 60+ second responses with only static "thinking"
        // dots). RAG retrieval above already completed by this point (it's
        // shared with the non-streaming branch), so the only genuine stage
        // boundary left to report is "the slow part - generation - is
        // starting now", which is also where most of the wait actually
        // lives (Gemini + optional Search grounding).
        controller.enqueue(ndjson({ type: "stage", stage: "generating" }));
        for await (const chunk of geminiStream) {
          const piece = chunk.text ?? "";
          if (piece.length === 0) continue;
          fullText += piece;
          controller.enqueue(ndjson({ type: "token", text: piece }));
        }

        // Persist the assistant's turn. Best-effort: a failure here must
        // not break the stream the user already received, and never
        // invents a placeholder message - it simply won't appear in
        // future history. Same non-fatal semantics as the pre-streaming
        // version.
        if (fullText.trim().length > 0) {
          try {
            await messageService.addAssistantMessage(conversationId, userId, fullText);
          } catch {
            // Non-fatal - see comment above.
          }
        }

        // Sprint R1.2 - Phase 2: real "ai_chat" event, additive, best-effort.
        await analyticsEventService.record(userId, "ai_chat").catch(() => {});

        controller.enqueue(ndjson({ type: "done", conversationId, ragApplied, sources }));
      } catch {
        controller.enqueue(ndjson({ type: "error", message: "The assistant could not finish responding" }));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Request-Id": ctx.requestId,
    },
  });
});
