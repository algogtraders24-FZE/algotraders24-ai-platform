// types/assistant.ts
import type { Message } from "./message";
import type { PromptVariables } from "./prompt";

export interface AssistantRequest {
  conversationId: string;
  message: string;
  templateId?: string;
  variables?: PromptVariables;
}

export interface AssistantResponse {
  message: Message;
  usedTemplateId: string | null;
}

/** Future providers (OpenAI, Claude, Gemini, etc.) implement this. */
export interface AIProvider {
  name: string;
  generate: (prompt: string) => Promise<string>;
}