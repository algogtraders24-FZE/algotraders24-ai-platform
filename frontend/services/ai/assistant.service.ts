// services/ai/assistant.service.ts
// 15C.1 - RAG-augmented chat. Calls the authenticated /api/private/knowledge/chat
// endpoint, which retrieves the user's own knowledge (scoped server-side),
// injects it as context, and answers with Gemini + Google Search.
// 15C.5 - forwards req.serverConversationId (when the caller has one) as
// `conversationId` in the request body so the server reuses the same
// Conversation across turns; other callers (publishing, trading-copilot,
// agents) never set it, so their requests are byte-for-byte unchanged.
// 15C.6 - loadServerMessages() reads a server conversation's persisted
// history back (GET /api/private/conversations/[id]/messages), for the
// client to restore a thread it doesn't have locally.
// 15C.8 - archiveServerConversation()/deleteServerConversation() propagate
// a local archive/unarchive/delete action to the linked server
// conversation (PATCH/DELETE /api/private/conversations/[id]).
// Request/response contracts (AssistantRequest/AssistantResponse) preserved.
//
// Sprint L2.4 - sendMessage() itself is UNTOUCHED: publishing,
// trading-copilot, and agents all call it expecting one blocking JSON
// response, and the chat route's default behavior (stream !== true) still
// returns exactly that shape. sendMessageStreaming() below is new and used
// only by the dashboard Assistant page. It has two real, distinct
// backends, never one fabricating the other's data:
//   - A message that mentions a supported market symbol (today: EUR/USD)
//     together with analysis-intent language is routed to the real
//     Sprint L2.1 pipeline (/api/private/market-intelligence/analyze),
//     returning a genuine MarketAnalysisResult (confidence/risk/evidence
//     all real, deterministic, never invented here).
//   - Everything else streams from the same RAG chat route as before,
//     just with {stream: true} to get progressive tokens plus real
//     sources instead of one blocking JSON blob.
import type { AssistantRequest, AssistantResponse } from "@/types/assistant";
import type { Message } from "@/types/message";
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";

export interface ChatSource {
  knowledgeId: string;
  title: string;
  chunkId: string;
  chunkIndex: number;
  similarity: number;
  snippet: string;
}

export interface StreamChatResult {
  kind: "chat";
  fullText: string;
  ragApplied: boolean;
  sources: ChatSource[];
  serverConversationId?: string;
}

export interface MarketAnalysisChatResult {
  kind: "market-analysis";
  result: MarketAnalysisResult;
}

export type SendStreamingResult = StreamChatResult | MarketAnalysisChatResult;

// Sprint L2.4 - a deliberately simple, disclosed heuristic: real NLP
// intent classification is out of scope for this sprint, and the only
// symbol genuinely wired to the real pipeline today is EUR/USD (see
// lib/market-data/providers/alpha-vantage.provider.ts). Requiring BOTH a
// symbol mention AND analysis-intent language reduces false positives
// (e.g. "what does euro mean" alone won't trigger it) without pretending
// to understand free text the way a real classifier would.
const SYMBOL_PATTERN = /\b(eur\s*\/?\s*usd|eurusd|euro)\b/i;
const ANALYSIS_INTENT_PATTERN =
  /\b(analy[sz]e|analysis|outlook|forecast|trend|view on|think about|opinion|should i|buy|sell|price|bullish|bearish)\b/i;

export function detectSupportedMarketSymbol(message: string): "EURUSD" | null {
  if (SYMBOL_PATTERN.test(message) && ANALYSIS_INTENT_PATTERN.test(message)) {
    return "EURUSD";
  }
  return null;
}

export function createUserMessage(content: string): Message {
  return {
    id: `m-${Date.now()}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

function toAssistantMessage(content: string): Message {
  return {
    id: `m-${Date.now()}`,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

export async function sendMessage(
  req: AssistantRequest,
): Promise<AssistantResponse> {
  const res = await fetch("/api/private/knowledge/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: req.message,
      useSearch: true,
      ...(req.serverConversationId ? { conversationId: req.serverConversationId } : {}),
    }),
  });

  const json = (await res.json().catch(() => null)) as {
    status?: string;
    data?: { content?: string; ragApplied?: boolean; sourcesCount?: number; conversationId?: string };
    error?: { message?: string };
  } | null;

  if (!res.ok || !json || json.status !== "ok" || !json.data) {
    throw new Error(json?.error?.message || "The assistant could not respond");
  }

  return {
    message: toAssistantMessage(json.data.content ?? ""),
    usedTemplateId: null,
    // Optional by design (see AssistantResponse) - an older/other response
    // shape without this field must not break the caller.
    serverConversationId:
      typeof json.data.conversationId === "string" ? json.data.conversationId : undefined,
  };
}

// Sprint L2.4 - streaming counterpart to sendMessage(), used only by the
// dashboard Assistant page. onToken fires as each real chunk of text
// arrives from Gemini (never a fabricated/simulated typing effect -
// there's a real network chunk behind every call). `signal` allows the
// caller to implement Stop Generation via a real AbortController.
export async function sendMessageStreaming(
  req: AssistantRequest,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<SendStreamingResult> {
  const symbol = detectSupportedMarketSymbol(req.message);

  if (symbol) {
    const res = await fetch("/api/private/market-intelligence/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, question: req.message }),
      signal,
    });
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      data?: { result?: MarketAnalysisResult };
      error?: { message?: string };
    } | null;

    if (!res.ok || !json || json.status !== "ok" || !json.data?.result) {
      throw new Error(json?.error?.message || "The market analysis could not be completed");
    }
    return { kind: "market-analysis", result: json.data.result };
  }

  const res = await fetch("/api/private/knowledge/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: req.message,
      useSearch: true,
      stream: true,
      ...(req.serverConversationId ? { conversationId: req.serverConversationId } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message || "The assistant could not respond");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let ragApplied = false;
  let sources: ChatSource[] = [];
  let serverConversationId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // last, possibly-incomplete line stays buffered

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "token"; text: string }
        | { type: "done"; conversationId?: string; ragApplied?: boolean; sources?: ChatSource[] }
        | { type: "error"; message: string };

      if (event.type === "token") {
        fullText += event.text;
        onToken(event.text);
      } else if (event.type === "done") {
        ragApplied = event.ragApplied ?? false;
        sources = event.sources ?? [];
        serverConversationId = event.conversationId;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }

  return { kind: "chat", fullText, ragApplied, sources, serverConversationId };
}

// Sprint 15C.6 - best-effort read of a server conversation's history.
// Never throws: a network failure, a 404 (not owned / not found), or an
// unexpected response shape all resolve to an empty array so a hydration
// caller never needs its own try/catch and can never crash the UI.
export async function loadServerMessages(serverConversationId: string): Promise<Message[]> {
  try {
    const res = await fetch(
      `/api/private/conversations/${encodeURIComponent(serverConversationId)}/messages`,
    );
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      data?: { messages?: unknown };
    } | null;

    if (!res.ok || !json || json.status !== "ok" || !Array.isArray(json.data?.messages)) {
      return [];
    }
    return json.data.messages as Message[];
  } catch {
    return [];
  }
}

// Sprint 15C.8 - best-effort propagation of a local archive/unarchive
// action to the linked server conversation. Never throws: a network
// failure or an ownership rejection just means the server conversation is
// unaffected - the local action (which the caller performs regardless) is
// never rolled back. Mirrors loadServerMessages's resilience convention.
export async function archiveServerConversation(
  serverConversationId: string,
  archived: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/private/conversations/${encodeURIComponent(serverConversationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Sprint 15C.8 - best-effort propagation of a local delete action to the
// linked server conversation (soft-delete server-side). Never throws, same
// rationale as archiveServerConversation above.
export async function deleteServerConversation(serverConversationId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/private/conversations/${encodeURIComponent(serverConversationId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch {
    return false;
  }
}
