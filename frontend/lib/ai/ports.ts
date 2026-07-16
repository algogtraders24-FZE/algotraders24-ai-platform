// lib/ai/ports.ts
// DIP - AI layer depends on this abstraction, not on the concrete
// Conversations module. Wire to your 14E service at ONE seam (container).
import type { AIMessage } from "./types";

export interface ConversationPort {
  loadHistory(conversationId: string): Promise<AIMessage[]>;
  appendTurn(conversationId: string, turn: AIMessage): Promise<void>;
}
