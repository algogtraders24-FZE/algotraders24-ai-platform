// services/ai/providers/gemini-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";
import type { Message } from "@/types/message";

async function callRoute(prompt: string): Promise<ProviderResponse> {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await res.json()) as { ok: boolean; content: string };
    return { provider: "gemini", content: data.content, implemented: true };
  } catch {
    return { provider: "gemini", content: "Network error reaching Gemini.", implemented: true };
  }
}

export const geminiProvider: AIProvider = {
  name: "gemini",
  generate: (prompt) => callRoute(prompt),
  chat: (messages: Message[]) => {
    const last = messages.filter((m) => m.role === "user").at(-1);
    return callRoute(last?.content ?? "");
  },
  summarize: (text) => callRoute(`Summarize:\n${text}`),
  analyze: (input) => callRoute(`Analyze:\n${input}`),
  healthCheck: async (): Promise<ProviderHealth> => {
    const start = Date.now();
    const res = await callRoute("ping");
    return {
      provider: "gemini",
      healthy: res.content.length > 0,
      message: `Latency ${Date.now() - start}ms`,
    };
  },
  stream: async function* (prompt) {
    // Placeholder: app has no streaming path yet. Yields full response once.
    const res = await callRoute(prompt);
    yield res.content;
  },
};