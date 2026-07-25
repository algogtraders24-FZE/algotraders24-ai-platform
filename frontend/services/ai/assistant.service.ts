// services/ai/assistant.service.ts
// 15C.1 - RAG-augmented chat. Calls the authenticated /api/private/knowledge/chat
// endpoint, which retrieves the user's own knowledge (scoped server-side),
// injects it as context, and answers with Gemini + Google Search.
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
    body: JSON.stringify({ query: req.message, useSearch: true }),
  });

  const json = (await res.json().catch(() => null)) as {
    status?: string;
    data?: { content?: string; ragApplied?: boolean; sourcesCount?: number };
    error?: { message?: string };
  } | null;

  if (!res.ok || !json || json.status !== "ok" || !json.data) {
    throw new Error(json?.error?.message || "The assistant could not respond");
  }

  return {
    message: toAssistantMessage(json.data.content ?? ""),
    usedTemplateId: null,
  };
}
