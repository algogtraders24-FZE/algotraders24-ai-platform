// services/knowledge/KnowledgeEngine.ts
// Public facade for the knowledge base.
// Sprint L2.2 - buildKnowledgeContext() is now async (retrieve() calls the
// real search route). getCollections() now comes from
// KnowledgeDocumentService (the real, DB-backed list already loaded for
// the page) instead of the deleted KnowledgeCollectionService, which
// returned hardcoded mock collections - that discrepancy meant the
// "Collections" metric on the dashboard was fake even though the
// collections shown elsewhere on the same page were real. avgRetrievalMs
// and aiReferences are no longer fabricated constants (42ms, mockRetrievals
// .length) - see the field comments below.

import type { KnowledgeDocument, KnowledgeContext, KnowledgeMetrics } from "@/types/knowledge";
import { getDocuments, getCollections } from "./KnowledgeDocumentService";
import { retrieve, getRetrievalHistory, getAverageLatencyMs } from "./KnowledgeRetriever";
import { buildContext } from "./KnowledgeContextBuilder";
import { getUsedCategories } from "./KnowledgeManager";

/** Real RAG entry: retrieve relevant docs and build a context block. */
export async function buildKnowledgeContext(query: string): Promise<KnowledgeContext> {
  const results = await retrieve(query);
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
    // Real average of this session's actual search round-trips - 0 until
    // a real search has run, never a hardcoded placeholder.
    avgRetrievalMs: getAverageLatencyMs(),
    // Sum of each document's real retrievalCount (a genuine Prisma column,
    // incremented by the real search route on every hit) - reflects
    // actual dashboard-search retrievals. Does not yet include AI
    // Assistant chat retrievals, which are a separate, untouched route
    // this sprint deliberately didn't modify - see the L2.2 report.
    aiReferences: docs.reduce((sum, d) => sum + d.retrievalCount, 0),
  };
}

export function getRelatedDocuments(doc: KnowledgeDocument, limit = 3): KnowledgeDocument[] {
  return getDocuments()
    .filter((d) => d.id !== doc.id && (d.category === doc.category || d.collection === doc.collection))
    .slice(0, limit);
}
