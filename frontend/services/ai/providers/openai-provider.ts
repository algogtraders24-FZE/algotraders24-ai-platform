// services/ai/providers/openai-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";

const NOT_IMPL = "Provider integration not implemented.";
const res: ProviderResponse = { provider: "openai", content: NOT_IMPL, implemented: false };

export const openaiProvider: AIProvider = {
  name: "openai",
  generate: async () => res,
  chat: async () => res,
  summarize: async () => res,
  analyze: async () => res,
  healthCheck: async (): Promise<ProviderHealth> => ({
    provider: "openai",
    healthy: false,
    message: NOT_IMPL,
  }),
  stream: async function* () {
    yield NOT_IMPL;
  },
};