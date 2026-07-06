// services/ai/conversation-manager.service.ts
import type { StoredConversation } from "@/types/conversation-metadata";
import type { Message } from "@/types/message";
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