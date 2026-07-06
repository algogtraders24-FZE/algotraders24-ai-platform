# AI Conversation Persistence — Architecture

Persistent AI workspace. Conversations survive refresh. No backend.

## Flow

UI → Conversation Manager → Conversation Repository → Storage Interface → (memory | local | indexeddb)

UI never touches localStorage directly.

## Repository Pattern

`conversation.repository.ts` does CRUD + search, talking only to a
`StorageProvider`. Swapping storage (or later Supabase/Firebase) changes
this one file — UI stays untouched.

## Storage Providers

All implement `StorageProvider` (get/set/remove):
- memory-storage — in-memory, SSR-safe fallback
- local-storage — browser localStorage, survives refresh
- indexeddb-storage — larger datasets, async

Interchangeable via the interface.

## Conversation Lifecycle

`conversation-manager.service.ts` owns: create, addMessage, rename, pin,
archive, restore, delete, loadRecent, search. Single source of truth.

## Persistence Flow

Send message → manager.addMessage → repository.save → storage.set →
localStorage. On load: repository.loadAll → render. Selected id also
persisted, so refresh restores the open chat.

## Future Cloud Sync

Implement a new StorageProvider (or repository) backed by Supabase/
PostgreSQL/Firebase/MongoDB/Redis. Same interface → zero UI changes.

## Offline-first Strategy

localStorage/IndexedDB act as the offline cache. A future sync layer can
push local changes to the cloud when online, using updatedAt for conflict
resolution.