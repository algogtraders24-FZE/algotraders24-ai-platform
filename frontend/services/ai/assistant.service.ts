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
// Request/response contracts (AssistantRequest/AssistantResponse) preserved.
import type { AssistantRequest, AssistantResponse } from "@/types/assistant";
import type { Message } from "@/types/message";

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
