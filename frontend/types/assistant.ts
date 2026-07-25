// types/assistant.ts
import type { Message } from "./message";
import type { PromptVariables } from "./prompt";

export interface AssistantRequest {
  conversationId: string;
  message: string;
  templateId?: string;
  variables?: PromptVariables;
  // Sprint 15C.5 - the server-side (DB) Conversation id, distinct from the
  // `conversationId` above which is a client-local thread label reused by
  // several callers (publishing, trading-copilot, agents) that have no
  // server conversation at all. Only the dashboard assistant page sets
  // this; when present it is sent to POST /api/private/knowledge/chat so
  // the same server conversation is reused across turns. Omit it to let
  // the server create a new conversation (its existing default behavior).
  serverConversationId?: string;
}

export interface AssistantResponse {
  message: Message;
  usedTemplateId: string | null;
  // Sprint 15C.5 - echoed back from the server response so the caller can
  // persist it and send it on the next turn. Absent on older/other
  // response shapes; callers must treat it as optional.
  serverConversationId?: string;
}