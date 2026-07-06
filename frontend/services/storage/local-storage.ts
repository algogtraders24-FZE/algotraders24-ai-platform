// services/storage/local-storage.ts
import type { StorageProvider } from "./storage.interface";
import { memoryStorage } from "./memory-storage";

const hasWindow = typeof window !== "undefined" && !!window.localStorage;

export const localStorageProvider: StorageProvider = hasWindow
  ? {
      get: async <T>(key: string): Promise<T | null> => {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
      remove: async (key: string): Promise<void> => {
        window.localStorage.removeItem(key);
      },
    }
  : memoryStorage;