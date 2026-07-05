// services/ai/providers/mock-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";
import type { Message } from "@/types/message";
import { mockResponses, DEFAULT_RESPONSE } from "@/data/mock-conversations";

function reply(text: string): string {
  const lower = text.toLowerCase();
  const match = mockResponses.find((r) => r.keywords.some((k) => lower.includes(k)));
  return match ? match.response : DEFAULT_RESPONSE;
}

function ok(content: string): ProviderResponse {
  return { provider: "mock", content, implemented: true };
}

export const mockProvider: AIProvider = {
  name: "mock",
  generate: async (prompt) => ok(reply(prompt)),
  chat: async (messages: Message[]) => {
    const last = messages.filter((m) => m.role === "user").at(-1);
    return ok(reply(last?.content ?? ""));
  },
  summarize: async (text) => ok(reply(text)),
  analyze: async (input) => ok(reply(input)),
  healthCheck: async (): Promise<ProviderHealth> => ({
    provider: "mock",
    healthy: true,
    message: "Mock provider operational.",
  }),
  stream: async function* (prompt) {
    yield reply(prompt);
  },
};