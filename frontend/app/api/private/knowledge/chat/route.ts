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
// Zero direct imports from any individual Sprint 15D internal analysis
// stage - asserted by every 15D validation script - is unchanged.
//
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat
// Integration. This route now delegates to the D2.6.5 chat-context layer
// (services/intelligence/chat/*) for questions that resolve to a real,
// known instrument - never guessed, never entered for an ordinary
// support/knowledge-base question. That layer is the ONLY new coupling
// point: this file never imports a 15D/D2.5 internal engine directly, it
// only calls the already-composed orchestrator and presenter/validator
// boundary - see docs/architecture/D2.6.5-realtime-intelligence-spec.md.
//
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. The single presenter call below now goes through the
// chat-facing presenter orchestrator (still services/intelligence/chat/*,
// still the only new coupling point) instead of one hardcoded presenter
// + one hardcoded fallback. The orchestrator tries multiple configured
// language-model backends in priority order and always validates before
// returning - see docs/architecture/D2.6.8-ai-presenter-reliability-spec.md.
//
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. The chat-context resolution and presenter call below are
// now composed inside one chat-facing entry point
// (IntelligencePresentationService, still services/intelligence/chat/*,
// still the only new coupling point) that additionally writes a real,
// immutable audit/provenance record for every presented answer - see
// docs/architecture/D2.6.9-intelligence-audit-explainability-spec.md.
// This route still never imports any individual Sprint 15D/D2.5 internal
// stage, nor any lower-level persistence boundary, directly.
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { ConversationMessageService, toMessage } from "@/services/ai/conversation-message.service";
import { prisma } from "@/lib/prisma";
import type { Message } from "@/types/message";
import { EntityNotFoundError, RepositoryError } from "@/types/repository";
import { analyticsEventService } from "@/services/analytics/AnalyticsEventService";
import { IntelligencePresentationService } from "@/services/intelligence/chat/intelligence-presentation.service";
// Sprint K3-B-3 - AI Assistant Knowledge Loop: the knowledge-first gate.
// Sits AFTER the market-intelligence gate below and runs for every
// non-market turn. It REPLACES this route's former inline
// RAG-embed + GoogleGenAI(+googleSearch) block: retrieval (the K1/K2
// eligibility-filtered, cache-safe path) is now the FIRST intelligence
// layer, Claude is the primary provider with native web search, and the
// provider chain Claude -> Gemini -> OpenAI -> deterministic is preserved.
// Every turn writes a KnowledgeAnswerProvenance row (best-effort). The
// non-stream response envelope + the NDJSON stream shape are unchanged for
// the publishing / trading-copilot / agents callers. See
// docs/architecture/AI_ASSISTANT_ORCHESTRATION_CONTRACT.md.
import { createKnowledgeAnswerOrchestrator } from "@/services/knowledge-loop/orchestrator";
import type { AnswerResult } from "@/types/knowledge-loop";

const MAX_TITLE_LENGTH = 60;

const messageService = new ConversationMessageService();
const intelligencePresentationService = new IntelligencePresentationService();

// Lazily constructed once per server instance - opens no DB connection and
// loads no provider until the first non-market chat turn.
let orchestratorPromise: ReturnType<typeof createKnowledgeAnswerOrchestrator> | null = null;
function knowledgeAnswerOrchestrator() {
  orchestratorPromise ??= createKnowledgeAnswerOrchestrator();
  return orchestratorPromise;
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
    symbol?: unknown;
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

  // Sprint D2.6.11 - optional, explicit "active instrument" bias for a
  // caller that already knows which symbol the trader is looking at (e.g.
  // the Workspace's AI Assistant panel, scoped to WorkspaceContext.symbol)
  // rather than relying solely on the question text mentioning one.
  // Resolution priority is unchanged from D2.6.2/D2.6.5: a symbol
  // mentioned explicitly in the question text still wins over this value
  // (services/intelligence/query/intelligence-query.service.ts's
  // resolveSymbol()) - this can bias, never force, which instrument a
  // question resolves against.
  const requestedSymbol = typeof body?.symbol === "string" && body.symbol.trim().length > 0 ? body.symbol.trim() : undefined;

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

  // --- Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat
  // Integration. Gated deterministically by the D2.6.5 chat-context layer
  // itself: only entered when a real, known instrument actually resolves
  // from this question - an ordinary support/knowledge-base question falls
  // straight through to the unchanged RAG/Gemini flow below. When entered,
  // the LLM never becomes the source of market facts - it only paraphrases
  // an already-verified context object, and a deterministic validator
  // rejects any paraphrase that smuggles in an unsupported claim (falling
  // back to a fully deterministic, still-real response instead).
  //
  // Sprint D2.6.7 - passing conversationId lets the D2.6.7 continuity
  // layer load/save persisted conversation context (which instrument/
  // timeframe was last discussed, which analysis run/hypothesis) so a
  // genuine follow-up ("what are the risks?", "what would invalidate
  // this?") resolves against the right context - never against stale
  // market facts, since a fresh provider request always still runs.
  //
  // Sprint D2.6.9 - the single call below now also writes a real,
  // immutable audit/provenance record for a resolved, presented answer
  // (best-effort - a write failure never breaks the response below).
  // Sprint D2.8.9 - Production Microstructure Activation. Requested by
  // default for every real-time intelligence turn - safe because
  // RealTimeIntelligenceService.fetchMicrostructure() (D2.8.7/D2.8.9) only
  // ever calls Binance when the resolved instrument's real canonical
  // provider mapping proves coverage (BTCUSD/ETHUSD today); every other
  // instrument short-circuits to `undefined` with zero network calls, and
  // any Binance failure/timeout is caught and non-fatal to this response.
  const { context: intelligenceContext, presented, verifiedAnswer } = await intelligencePresentationService.present({ requestId: ctx.requestId, userId, message: query, conversationId, symbol: requestedSymbol, includeMicrostructure: true });

  // Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
  // Experience. `verifiedAnswer` (when present) IS the stable
  // VerifiedAnswerResponse contract (types/verified-answer-response.ts) a
  // future UI renders directly - it is spread into the wire payload
  // alongside `resolved: true` rather than duplicated into a second,
  // narrower summary object.
  interface ChatIntelligenceMeta {
    resolved: boolean;
    reason?: string;
    dataFreshness?: string;
  }

  let intelligenceAnswer: string | undefined;
  let intelligenceMeta: (ChatIntelligenceMeta & Partial<typeof verifiedAnswer>) | undefined;

  if (intelligenceContext.status === "resolved" && intelligenceContext.envelope && presented && verifiedAnswer) {
    intelligenceAnswer = presented.text;
    intelligenceMeta = { resolved: true, ...verifiedAnswer };
  } else if (intelligenceContext.status === "insufficient-data") {
    intelligenceAnswer =
      "I attempted to retrieve verified, real-time market data for this question but could not confirm it right now (the data source may be temporarily unavailable). Please try again shortly.";
    intelligenceMeta = { resolved: false, reason: "insufficient-data", dataFreshness: intelligenceContext.dataQuality?.state ?? "unavailable" };
  } else if (intelligenceContext.status === "clarification-required" && intelligenceContext.clarification?.reason === "ambiguous-symbol") {
    intelligenceAnswer = intelligenceContext.clarification.message;
    intelligenceMeta = { resolved: false, reason: "ambiguous-symbol" };
  }
  // Any other outcome (no real instrument resolved at all - the ordinary
  // case for non-market questions) leaves intelligenceAnswer undefined and
  // falls straight through to the existing knowledge-base/general chat
  // flow below, completely unchanged.

  if (intelligenceAnswer !== undefined) {
    const finalAnswer = intelligenceAnswer;
    try {
      await messageService.addAssistantMessage(conversationId, userId, finalAnswer);
    } catch {
      // Non-fatal - matches every other assistant-message persistence in this route.
    }
    await analyticsEventService.record(userId, "ai_chat").catch(() => {});

    if (!wantsStream) {
      return ApiResponse.success(
        { content: finalAnswer, ragApplied: false, sourcesCount: 0, sources: [], conversationId, intelligence: intelligenceMeta },
        ctx.requestId,
        200,
        ctx.startedAt,
      );
    }

    const intelligenceStreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ndjson({ type: "stage", stage: "generating" }));
        controller.enqueue(ndjson({ type: "token", text: finalAnswer }));
        controller.enqueue(ndjson({ type: "done", conversationId, ragApplied: false, sources: [], intelligence: intelligenceMeta }));
        controller.close();
      },
    });
    return new NextResponse(intelligenceStreamBody, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Request-Id": ctx.requestId },
    });
  }

  // --- Knowledge-first gate (Sprint K3-B-3) ---
  // Replaces this route's former inline RAG-embed + GoogleGenAI(+googleSearch)
  // block. `orchestrator.answer()` runs retrieval FIRST (the K1/K2
  // eligibility-filtered, cache-safe path - INV-1 safe), decides web search
  // by a disclosed heuristic gate, runs the provider chain
  // Claude(+web_search) -> Gemini -> OpenAI -> deterministic, scans the
  // winning answer for forbidden language, and writes a
  // KnowledgeAnswerProvenance row (best-effort). It is designed never to
  // throw: a total failure yields a truthful deterministic message.
  let result: AnswerResult;
  try {
    const orchestrator = await knowledgeAnswerOrchestrator();
    result = await orchestrator.answer({
      requestId: ctx.requestId,
      callerUserId: userId,
      callerRole: sessionUser.profile.role,
      conversationId,
      messageId: currentMessage?.id,
      message: query,
      history: recentMessages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      symbol: requestedSymbol,
      knowledgeId,
    });
  } catch {
    // Defensive only - the orchestrator does not throw. The persisted user
    // turn is preserved; same failure semantics as the prior Gemini
    // pre-generation failure.
    return ApiResponse.error(
      { code: "AI_FAILED", message: "The assistant could not respond" },
      ctx.requestId,
      500,
      ctx.startedAt
    );
  }

  const answer = result.text;
  const ragApplied =
    result.sourceClass === "AT24_KNOWLEDGE" || result.sourceClass === "MIXED";

  // Knowledge sources -> the existing Sources-panel shape. Real document
  // titles are looked up best-effort (omitted, never fabricated, on failure)
  // exactly as the previous inline RAG did.
  let sources: ChatSource[] = [];
  const knowledgeRefs = result.sources.filter((s) => s.kind === "knowledge");
  if (knowledgeRefs.length > 0) {
    try {
      const ids = [
        ...new Set(
          knowledgeRefs.map((s) => s.knowledgeId).filter((v): v is string => !!v),
        ),
      ];
      const docs = await prisma.knowledge.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      });
      const titleById = new Map(docs.map((d) => [d.id, d.title]));
      sources = knowledgeRefs.map((s) => ({
        knowledgeId: s.knowledgeId ?? "",
        title: titleById.get(s.knowledgeId ?? "") ?? "Untitled document",
        chunkId: s.chunkId ?? "",
        chunkIndex: s.chunkIndex ?? 0,
        similarity: s.similarity ?? 0,
        snippet: s.snippet ?? "",
      }));
    } catch {
      sources = [];
    }
  }

  // Web citations (Claude native web_search). Additive `webSources` key -
  // existing callers ignore unknown fields. Anthropic ToS: citations are
  // shown to the end user when API output is displayed directly.
  const webSources = result.sources
    .filter((s) => s.kind === "web")
    .map((s) => ({ url: s.url ?? "", title: s.title ?? "", citedText: s.citedText ?? "" }));

  const knowledgeMeta = {
    sourceClass: result.sourceClass,
    provider: result.providerUsed,
    webSearchUsed: result.webSearchUsed,
    webSearchRequestedButUnavailable: result.webSearchRequestedButUnavailable,
  };

  if (answer.trim().length > 0) {
    try {
      await messageService.addAssistantMessage(conversationId, userId, answer);
    } catch {
      // Non-fatal - matches every other assistant-message persistence here.
    }
  }
  // Sprint R1.2 - Phase 2: real "ai_chat" event, additive, best-effort.
  await analyticsEventService.record(userId, "ai_chat").catch(() => {});

  if (!wantsStream) {
    // Pre-L2.4 behaviour: one blocking JSON response. The existing keys are
    // unchanged for the publishing / trading-copilot / agents callers;
    // `webSources` + `knowledge` are additive.
    return ApiResponse.success(
      {
        content: answer,
        ragApplied,
        sourcesCount: sources.length,
        sources,
        webSources,
        conversationId,
        knowledge: knowledgeMeta,
      },
      ctx.requestId,
      200,
      ctx.startedAt
    );
  }

  // --- Streaming (opt-in via {stream: true}) ---
  // The orchestrator returns the COMPLETE answer, so - exactly like the
  // market-intelligence branch above (see the intelligence stream body) -
  // it is emitted as a single `token` event, not token-by-token. True
  // Claude token streaming is K8 (needs ClaudeProvider.stream()).
  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(ndjson({ type: "stage", stage: "generating" }));
      controller.enqueue(ndjson({ type: "token", text: answer }));
      controller.enqueue(
        ndjson({ type: "done", conversationId, ragApplied, sources, webSources, knowledge: knowledgeMeta }),
      );
      controller.close();
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
