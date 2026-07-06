// services/storage/memory-storage.ts
import type { StorageProvider } from "./storage.interface";

const store = new Map<string, unknown>();

export const memoryStorage: StorageProvider = {
  get: async <T>(key: string): Promise<T | null> => (store.has(key) ? (store.get(key) as T) : null),
  set: async <T>(key: string, value: T): Promise<void> => {
    store.set(key, value);
  },
  remove: async (key: string): Promise<void> => {
    store.delete(key);
  },
};