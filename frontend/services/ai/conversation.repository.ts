// services/ai/conversation.repository.ts
import type { StoredConversation } from "@/types/conversation-metadata";
import type { StorageProvider } from "@/services/storage/storage.interface";
import { localStorageProvider } from "@/services/storage/local-storage";
import { STORAGE_KEYS } from "@/types/storage";

const storage: StorageProvider = localStorageProvider;

export async function loadAll(): Promise<StoredConversation[]> {
  return (await storage.get<StoredConversation[]>(STORAGE_KEYS.conversations)) ?? [];
}

async function saveAll(list: StoredConversation[]): Promise<void> {
  await storage.set(STORAGE_KEYS.conversations, list);
}

export async function save(conv: StoredConversation): Promise<void> {
  const list = await loadAll();
  const idx = list.findIndex((c) => c.id === conv.id);
  if (idx >= 0) list[idx] = conv;
  else list.unshift(conv);
  await saveAll(list);
}

export async function remove(id: string): Promise<void> {
  const list = (await loadAll()).filter((c) => c.id !== id);
  await saveAll(list);
}

export async function search(query: string): Promise<StoredConversation[]> {
  const q = query.toLowerCase();
  return (await loadAll()).filter((c) => c.title.toLowerCase().includes(q));
}

export async function getSelectedId(): Promise<string | null> {
  return storage.get<string>(STORAGE_KEYS.selectedId);
}

export async function setSelectedId(id: string | null): Promise<void> {
  if (id) await storage.set(STORAGE_KEYS.selectedId, id);
  else await storage.remove(STORAGE_KEYS.selectedId);
}