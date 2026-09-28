// services/ai/conversation.repository.ts
import type { StoredConversation } from "@/types/conversation-metadata";
import type { StorageProvider } from "@/services/storage/storage.interface";
import { localStorageProvider } from "@/services/storage/local-storage";
import { STORAGE_KEYS } from "@/types/storage";

const storage: StorageProvider = localStorageProvider;

// The storage keys below used to be global, unscoped strings - fine for a
// single-account browser, but a real bug the moment a second account signs
// in on the same browser/device: the new account's sidebar would show the
// previous account's local conversation list until each one happened to get
// reconciled from the server. Scoping every key to the current user id closes
// that - each account gets its own slice of localStorage, and switching
// accounts on a shared browser can no longer leak one account's chat titles
// into another's sidebar. Call setNamespace(user.id) once the current user is
// known (assistant/page.tsx does this before its first repo call) - every
// function below falls back to the unscoped legacy key if it's never called,
// so this stays backward-compatible for any caller that doesn't opt in yet.
let namespace: string | null = null;

export function setNamespace(userId: string | null): void {
  namespace = userId;
}

function scopedKey(base: string): string {
  return namespace ? `${base}:${namespace}` : base;
}

export async function loadAll(): Promise<StoredConversation[]> {
  return (await storage.get<StoredConversation[]>(scopedKey(STORAGE_KEYS.conversations))) ?? [];
}

async function saveAll(list: StoredConversation[]): Promise<void> {
  await storage.set(scopedKey(STORAGE_KEYS.conversations), list);
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
  return storage.get<string>(scopedKey(STORAGE_KEYS.selectedId));
}

export async function setSelectedId(id: string | null): Promise<void> {
  if (id) await storage.set(scopedKey(STORAGE_KEYS.selectedId), id);
  else await storage.remove(scopedKey(STORAGE_KEYS.selectedId));
}