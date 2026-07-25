// types/conversation-metadata.ts
import type { Conversation } from "./conversation";

export interface ConversationMeta {
  pinned: boolean;
  archived: boolean;
}

export interface StoredConversation extends Conversation {
  pinned: boolean;
  archived: boolean;
  // Sprint 15C.5 - the server-side (DB) Conversation this thread is linked
  // to, once the first message has round-tripped. Absent for a brand-new
  // local conversation and for any conversation created before this sprint
  // (legacy localStorage data) - both cases just mean "no server
  // conversation yet"; the next message creates one and links it here.
  serverConversationId?: string;
}