// types/storage.ts
export type StorageKind = "memory" | "local" | "indexeddb";

export const STORAGE_KEYS = {
  conversations: "at24:conversations",
  selectedId: "at24:selected-conversation",
} as const;