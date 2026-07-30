// services/knowledge/KnowledgeDocumentService.ts
// Sprint 14E - Backed by PostgreSQL. Documents and collections are loaded once
// via load(); every existing accessor stays synchronous, so callers are
// unchanged.
// Sprint L2.2 - removed addDocument()/setStatus(), the optimistic
// in-memory mutations this file's own header used to promise "land with
// the RAG sprint" - they now do: upload and re-index both happen for real
// server-side (KnowledgeApi.uploadDocument / KnowledgeApi.reindex), and
// callers refresh this list via load({force: true}) afterward instead of
// hand-patching a local copy.
import type { KnowledgeDocument, KnowledgeCollection } from "@/types/knowledge";
import { KnowledgeApi } from "@/services/api/KnowledgeApi";

let documents: KnowledgeDocument[] = [];
let collections: KnowledgeCollection[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;

export function isLoaded(): boolean {
  return loaded;
}

export async function load(
  options: { signal?: AbortSignal; force?: boolean } = {}
): Promise<void> {
  if (loaded && !options.force) return;
  if (inFlight && !options.force) return inFlight;

  if (options.force) KnowledgeApi.invalidate();

  inFlight = KnowledgeApi.load({ signal: options.signal }).then((data) => {
    documents = data.items;
    collections = data.collections;
    loaded = true;
  });

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

export function getDocuments(): KnowledgeDocument[] {
  return documents;
}

export function getCollections(): KnowledgeCollection[] {
  return collections;
}

export function getDocumentById(id: string): KnowledgeDocument | undefined {
  return documents.find((d) => d.id === id);
}

export function getByCategory(category: string): KnowledgeDocument[] {
  return documents.filter((d) => d.category === category);
}

export function getByCollection(collection: string): KnowledgeDocument[] {
  return documents.filter((d) => d.collection === collection);
}