// services/ai/providers/deepseek-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";

const NOT_IMPL = "Provider integration not implemented.";
const res: ProviderResponse = { provider: "deepseek", content: NOT_IMPL, implemented: false };

export const deepseekProvider: AIProvider = {
  name: "deepseek",
  generate: async () => res,
  chat: async () => res,
  summarize: async () => res,
  analyze: async () => res,
  healthCheck: async (): Promise<ProviderHealth> => ({
    provider: "deepseek",
    healthy: false,
    message: NOT_IMPL,
  }),
  stream: async function* () {
    yield NOT_IMPL;
  },
};