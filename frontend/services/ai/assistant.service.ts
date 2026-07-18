// services/ai/assistant.service.ts
// 15A.4-fix: client-side service. Gemini key server-side only, isliye
// AIService seedha nahi — /api/ai (server route) ko fetch karta hai.
// useSearch: true -> Google Search tool se real-time data (search path).
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
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.message, useSearch: true }),
  });

  const data = (await res.json()) as {
    ok: boolean;
    content: string;
    kind?: string;
  };

  if (!data.ok) {
    throw new Error(data.content || "AI request failed");
  }

  return {
    message: toAssistantMessage(data.content),
    usedTemplateId: null,
  };
}
