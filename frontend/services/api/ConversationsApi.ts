// services/api/ConversationsApi.ts
// Sprint 14E - Typed access to the conversations private API route.
import { ApiClient, type RequestOptions } from "./ApiClient";

export interface ConversationListItem {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  // Sprint 15C.9 - the route has returned this since Sprint 15C.7 (the
  // Conversation.archived column); the type just never caught up.
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationsEnvelope {
  items: ConversationListItem[];
  total: number;
}

const CONVERSATIONS_TTL_MS = 30 * 1000;

export class ConversationsApi {
  static async load(options: RequestOptions = {}): Promise<ConversationsEnvelope> {
    return ApiClient.get<ConversationsEnvelope>("/api/private/conversations", {
      cacheTtlMs: CONVERSATIONS_TTL_MS,
      retries: 2,
      ...options,
    });
  }
  static invalidate(): void {
    ApiClient.invalidate("/api/private/conversations");
  }
}
