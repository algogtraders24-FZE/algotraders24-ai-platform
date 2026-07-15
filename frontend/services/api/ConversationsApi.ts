// services/api/ConversationsApi.ts
// Sprint 14E - Typed access to the conversations private API route.
import { ApiClient, type RequestOptions } from "./ApiClient";

export interface ConversationListItem {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
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
