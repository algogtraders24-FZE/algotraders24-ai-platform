// config/ai.config.ts
import type { ProviderName } from "@/types/provider-name";

export const AI_CONFIG = {
  defaultProvider: (process.env.DEFAULT_AI_PROVIDER as ProviderName) ?? "gemini",
  defaultModel: process.env.DEFAULT_AI_MODEL ?? "gemini-2.5-flash",
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30000,
  retryCount: 2,
} as const;