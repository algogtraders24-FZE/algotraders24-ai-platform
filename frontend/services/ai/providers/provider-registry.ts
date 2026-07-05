// services/ai/providers/provider-registry.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderName } from "@/types/provider-name";
import { mockProvider } from "./mock-provider";
import { openaiProvider } from "./openai-provider";
import { claudeProvider } from "./claude-provider";
import { geminiProvider } from "./gemini-provider";
import { deepseekProvider } from "./deepseek-provider";
import { ollamaProvider } from "./ollama-provider";

export const providerRegistry: Record<ProviderName, AIProvider> = {
  mock: mockProvider,
  openai: openaiProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
  deepseek: deepseekProvider,
  ollama: ollamaProvider,
};