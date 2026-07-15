// services/ai/conversation.service.ts
// Sprint 14E - DB-backed conversation list via ConversationsApi.
// Full message threads are handled by the assistant/local layer, not here.
import { ConversationsApi, type ConversationListItem } from "@/services/api/ConversationsApi";
import type { ConversationSummary } from "@/types/conversation";
import type { RequestOptions } from "@/services/api/ApiClient";

/** Full conversation list for the authenticated user (summary rows). */
export async function getConversations(
  options: RequestOptions = {}
): Promise<ConversationListItem[]> {
  const { items } = await ConversationsApi.load(options);
  return items;
}

/** Lightweight summaries (id/title/updatedAt) for sidebars and pickers. */
export async function getConversationSummaries(
  options: RequestOptions = {}
): Promise<ConversationSummary[]> {
  const { items } = await ConversationsApi.load(options);
  return items.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

/** Single conversation summary by id, or null if not found. */
export async function getConversationById(
  id: string,
  options: RequestOptions = {}
): Promise<ConversationListItem | null> {
  const { items } = await ConversationsApi.load(options);
  return items.find((c) => c.id === id) ?? null;
}
