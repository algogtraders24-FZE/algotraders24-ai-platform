// services/knowledge/KnowledgeDocumentService.ts
// Sprint 14E - Backed by PostgreSQL. Documents and collections are loaded once
// via load(); every existing accessor stays synchronous, so callers are
// unchanged. Local mutations (upload, status change) update the in-memory view
// optimistically; persistence of those mutations lands with the RAG sprint.
import type {
  KnowledgeDocument,
  KnowledgeCollection,
  DocumentStatus,
} from "@/types/knowledge";
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

export function addDocument(doc: KnowledgeDocument): void {
  documents = [doc, ...documents];
}

export function setStatus(
  id: string,
  status: DocumentStatus
): KnowledgeDocument | undefined {
  documents = documents.map((d) => (d.id === id ? { ...d, status } : d));
  return getDocumentById(id);
}