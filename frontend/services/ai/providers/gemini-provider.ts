// services/ai/providers/gemini-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";

const NOT_IMPL = "Provider integration not implemented.";
const res: ProviderResponse = { provider: "gemini", content: NOT_IMPL, implemented: false };

export const geminiProvider: AIProvider = {
  name: "gemini",
  generate: async () => res,
  chat: async () => res,
  summarize: async () => res,
  analyze: async () => res,
  healthCheck: async (): Promise<ProviderHealth> => ({
    provider: "gemini",
    healthy: false,
    message: NOT_IMPL,
  }),
  stream: async function* () {
    yield NOT_IMPL;
  },
};