// types/conversation-metadata.ts
import type { Conversation } from "./conversation";

export interface ConversationMeta {
  pinned: boolean;
  archived: boolean;
}

export interface StoredConversation extends Conversation {
  pinned: boolean;
  archived: boolean;
}