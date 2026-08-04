// services/ai/conversation-manager.service.ts
import type { StoredConversation } from "@/types/conversation-metadata";
import type { Message } from "@/types/message";
import type { ConversationListItem } from "@/services/api/ConversationsApi";
import * as repo from "./conversation.repository";

function now(): string {
  return new Date().toISOString();
}

export async function createConversation(title = "New Chat"): Promise<StoredConversation> {
  const conv: StoredConversation = {
    id: `conv-${Date.now()}`,
    title,
    messages: [],
    createdAt: now(),
    updatedAt: now(),
    pinned: false,
    archived: false,
  };
  await repo.save(conv);
  return conv;
}

export async function addMessage(conv: StoredConversation, message: Message): Promise<StoredConversation> {
  const updated: StoredConversation = {
    ...conv,
    messages: [...conv.messages, message],
    updatedAt: now(),
  };
  await repo.save(updated);
  return updated;
}

export async function rename(conv: StoredConversation, title: string): Promise<StoredConversation> {
  const updated = { ...conv, title, updatedAt: now() };
  await repo.save(updated);
  return updated;
}

export async function setPinned(conv: StoredConversation, pinned: boolean): Promise<StoredConversation> {
  const updated = { ...conv, pinned };
  await repo.save(updated);
  return updated;
}

export async function setArchived(conv: StoredConversation, archived: boolean): Promise<StoredConversation> {
  const updated = { ...conv, archived };
  await repo.save(updated);
  return updated;
}

// Sprint 15C.5 - link this local thread to the server Conversation returned
// by the first successful chat response, so later turns reuse it instead of
// creating a new one each time.
export async function setServerConversationId(
  conv: StoredConversation,
  serverConversationId: string,
): Promise<StoredConversation> {
  const updated = { ...conv, serverConversationId };
  await repo.save(updated);
  return updated;
}

// Sprint 15C.6 - restore a thread's messages from the server (the id it was
// linked to via setServerConversationId). Conservative by design: only
// fills in when the local conversation has no messages of its own, so it
// can never overwrite or duplicate anything the user already has locally
// (e.g. a message typed while offline that never made it to the server).
// A local conversation with no serverConversationId (brand new, or legacy
// pre-15C.5 data) is untouched - the caller simply shouldn't call this
// without one.
export async function hydrateFromServer(
  conv: StoredConversation,
  serverMessages: Message[],
): Promise<StoredConversation> {
  if (conv.messages.length > 0 || serverMessages.length === 0) {
    return conv;
  }
  const updated: StoredConversation = { ...conv, messages: serverMessages, updatedAt: now() };
  await repo.save(updated);
  return updated;
}

// Sprint 15C.9 - discover server conversations this device doesn't know
// about yet (localStorage loss, a different browser/device, or simply
// never having sent a message from here) and create a local representation
// for each. Matching is solely by exact serverConversationId equality - no
// title/timestamp/content heuristic ever runs - so a local-only
// conversation with no serverConversationId can never be matched or merged
// into any server conversation, and a conversation already linked locally
// is never re-touched, overwritten, or duplicated. Deleted server
// conversations never reach this function at all: GET
// /api/private/conversations already excludes them, so `serverConversations`
// is expected to be exactly that (already-filtered) list. Never calls the
// chat endpoint, so recovery itself can never create a new server
// conversation.
//
// Sprint D2.3.S2 - stubs are created with messages: [] and NO fetch call at
// all (previously fetched full message history for every unknown
// conversation here, sequentially - the audit's 21.8s/28.4s findings).
// Real content loads lazily the moment a conversation is actually selected,
// via the existing hydrateFromServer() + the "no local messages yet" effect
// in app/dashboard/assistant/page.tsx - unchanged, already handles this
// case. Reconciliation itself is now a single in-memory pass over data the
// caller already has (the server list), zero extra network calls.
export async function reconcileServerConversations(
  serverConversations: readonly ConversationListItem[],
): Promise<StoredConversation[]> {
  const local = await loadRecent();
  const knownServerIds = new Set(
    local
      .map((c) => c.serverConversationId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const recovered: StoredConversation[] = [];
  for (const server of serverConversations) {
    if (knownServerIds.has(server.id)) continue; // already known - never overwrite, never duplicate

    const conv: StoredConversation = {
      id: `conv-${Date.now()}-${recovered.length}`,
      title: server.title,
      messages: [],
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      pinned: false,
      archived: server.archived ?? false,
      serverConversationId: server.id,
    };
    await repo.save(conv);
    recovered.push(conv);
    knownServerIds.add(server.id); // guards against duplicate ids within the same server list
  }
  return recovered;
}

export async function deleteConversation(id: string): Promise<void> {
  await repo.remove(id);
}

export async function loadRecent(): Promise<StoredConversation[]> {
  const list = await repo.loadAll();
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export async function searchConversations(query: string): Promise<StoredConversation[]> {
  return repo.search(query);
}

export const selectedId = {
  get: repo.getSelectedId,
  set: repo.setSelectedId,
};