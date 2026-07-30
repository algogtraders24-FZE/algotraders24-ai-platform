// services/knowledge/KnowledgeManager.ts
// Manages the document library: listing, filtering, and re-index.
// Sprint L2.2 - Upload is no longer here: it's a real, server-side flow
// now (services/api/KnowledgeApi.uploadDocument -> app/api/private/
// knowledge/upload/route.ts), not a client-side function that fabricates
// a document object. reindex() calls the real re-embed route instead of
// the removed simulated KnowledgeIndexer.

import type { KnowledgeDocument } from "@/types/knowledge";
import { KNOWLEDGE_CATEGORIES } from "@/config/knowledge.config";
import { getDocuments, getByCategory } from "./KnowledgeDocumentService";
import { KnowledgeApi } from "@/services/api/KnowledgeApi";

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

export async function reindex(id: string): Promise<boolean> {
  const result = await KnowledgeApi.reindex(id);
  return result.status === "indexed";
}
