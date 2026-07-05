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