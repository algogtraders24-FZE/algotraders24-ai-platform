// services/ai/providers/claude-provider.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderResponse, ProviderHealth } from "@/types/provider-response";

const NOT_IMPL = "Provider integration not implemented.";
const res: ProviderResponse = { provider: "claude", content: NOT_IMPL, implemented: false };

export const claudeProvider: AIProvider = {
  name: "claude",
  generate: async () => res,
  chat: async () => res,
  summarize: async () => res,
  analyze: async () => res,
  healthCheck: async (): Promise<ProviderHealth> => ({
    provider: "claude",
    healthy: false,
    message: NOT_IMPL,
  }),
  stream: async function* () {
    yield NOT_IMPL;
  },
};