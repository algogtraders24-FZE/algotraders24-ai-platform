// services/storage/indexeddb-storage.ts
import type { StorageProvider } from "./storage.interface";
import { memoryStorage } from "./memory-storage";

const DB_NAME = "at24-db";
const STORE = "kv";
const hasIDB = typeof window !== "undefined" && !!window.indexedDB;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const indexedDbStorage: StorageProvider = hasIDB
  ? {
      get: async <T>(key: string): Promise<T | null> => {
        const val = await tx<T | undefined>("readonly", (s) => s.get(key));
        return val ?? null;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await tx("readwrite", (s) => s.put(value, key));
      },
      remove: async (key: string): Promise<void> => {
        await tx("readwrite", (s) => s.delete(key));
      },
    }
  : memoryStorage;