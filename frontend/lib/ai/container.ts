// lib/ai/container.ts
// Composition root. Requirement #4: register GeminiProvider WITHOUT
// changing any consumer. createAIService() signature is unchanged.
import { AIService } from "./ai.service";
import { GeminiProvider } from "./providers/gemini.provider";
import { PlaceholderProvider } from "./providers/placeholder.provider";
import type { AIProvider } from "./provider.interface";
import type { ConversationPort } from "./ports";

// ADAPT: still a no-op — persistence is deferred (not this sprint).
const noopConversations: ConversationPort = {
  async loadHistory() {
    return [];
  },
  async appendTurn() {
    /* deferred to a later sprint */
  },
};

// Provider selection is env-driven so swapping providers needs no code change.
function selectProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  switch (provider) {
    case "placeholder":
      return new PlaceholderProvider();
    case "gemini":
    default:
      return new GeminiProvider();
  }
}

export function createAIService(): AIService {
  return new AIService(selectProvider(), noopConversations);
}