// services/knowledge/KnowledgeSearchService.ts
// Sprint L2.2 - Real vector similarity search: calls the same
// /api/private/knowledge/search route the AI Assistant's RAG chat already
// uses (Gemini embeds the query, then cosine-search over pgvector).
// Replaces the previous keyword-overlap mock
// (KnowledgeEmbeddingService.mockSimilarity - no longer called here).
import type { SearchResult } from "@/types/knowledge";
import { getDocumentById } from "./KnowledgeDocumentService";
import { KnowledgeApi } from "@/services/api/KnowledgeApi";

const SNIPPET_MAX_CHARS = 200;

export async function searchKnowledge(query: string, limit = 5): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const chunks = await KnowledgeApi.search(query, limit);

  const results: SearchResult[] = [];
  for (const chunk of chunks) {
    // The parent document must already be in the locally-loaded list - if
    // it isn't (a stale local cache), skip rather than fabricate one.
    const document = getDocumentById(chunk.knowledgeId);
    if (!document) continue;

    results.push({
      document,
      score: Math.round(chunk.similarity * 100),
      snippet: chunk.content.length > SNIPPET_MAX_CHARS ? `${chunk.content.slice(0, SNIPPET_MAX_CHARS)}…` : chunk.content,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
    });
  }
  return results;
}
