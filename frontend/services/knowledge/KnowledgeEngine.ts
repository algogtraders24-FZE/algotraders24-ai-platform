// services/knowledge/KnowledgeEngine.ts
// Public facade for the knowledge base. Implements the future RAG pipeline
// entry (query -> retrieve -> context) and exposes metrics + related docs.

import type { KnowledgeDocument, KnowledgeContext, KnowledgeMetrics } from "@/types/knowledge";
import { getDocuments } from "./KnowledgeDocumentService";
import { getCollections } from "./KnowledgeCollectionService";
import { retrieve, getRetrievalHistory } from "./KnowledgeRetriever";
import { buildContext } from "./KnowledgeContextBuilder";
import { getUsedCategories } from "./KnowledgeManager";
import { mockRetrievals } from "@/data/mock-knowledge";

/** Future RAG entry: retrieve relevant docs and build a context block. */
export function buildKnowledgeContext(query: string): KnowledgeContext {
  const results = retrieve(query);
  return buildContext(query, results);
}

export function getMetrics(): KnowledgeMetrics {
  const docs = getDocuments();
  const indexed = docs.filter((d) => d.status === "indexed").length;
  const health = docs.length ? Math.round((indexed / docs.length) * 100) : 0;

  return {
    totalDocuments: docs.length,
    categories: getUsedCategories().length,
    collections: getCollections().length,
    indexedDocuments: indexed,
    searchesToday: getRetrievalHistory().length,
    knowledgeHealth: health,
    avgRetrievalMs: 42, // mock latency
    aiReferences: mockRetrievals.length,
  };
}

export function getRelatedDocuments(doc: KnowledgeDocument, limit = 3): KnowledgeDocument[] {
  return getDocuments()
    .filter((d) => d.id !== doc.id && (d.category === doc.category || d.collection === doc.collection))
    .slice(0, limit);
}