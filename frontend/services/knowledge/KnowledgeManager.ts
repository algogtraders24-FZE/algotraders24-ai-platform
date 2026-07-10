// services/knowledge/KnowledgeManager.ts
// Manages the document library: listing, filtering, upload, and re-index.

import type { KnowledgeDocument } from "@/types/knowledge";
import { KNOWLEDGE_CATEGORIES } from "@/config/knowledge.config";
import { getDocuments, getByCategory, addDocument, setStatus } from "./KnowledgeDocumentService";
import { indexDocument } from "./KnowledgeIndexer";

export function listDocuments(): KnowledgeDocument[] {
  return getDocuments();
}

export function filterByCategory(category: string): KnowledgeDocument[] {
  return category === "all" ? getDocuments() : getByCategory(category);
}

export function getUsedCategories(): string[] {
  const used = new Set(getDocuments().map((d) => d.category));
  return KNOWLEDGE_CATEGORIES.filter((c) => used.has(c));
}

/** Simulated upload — creates a pending document from minimal input. */
export function uploadDocument(title: string, category: string, collection: string): KnowledgeDocument {
  const now = new Date().toISOString();
  const doc: KnowledgeDocument = {
    id: `doc-${Date.now()}`,
    title,
    description: "Uploaded document awaiting indexing.",
    category,
    collection,
    author: "You",
    tags: [],
    provider: "gemini",
    language: "en",
    fileType: "md",
    documentSize: 0,
    createdAt: now,
    updatedAt: now,
    lastIndexed: null,
    status: "pending",
    embeddingStatus: "pending",
    retrievalCount: 0,
    popularity: 0,
  };
  addDocument(doc);
  return doc;
}

export async function reindex(id: string): Promise<boolean> {
  setStatus(id, "processing");
  const result = await indexDocument(id);
  return Boolean(result?.indexed);
}