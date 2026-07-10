// services/knowledge/KnowledgeSearchService.ts
// Keyword/similarity search over documents. Mock scoring today; a real version
// uses vector similarity from the embedding service.

import type { SearchResult } from "@/types/knowledge";
import { getDocuments } from "./KnowledgeDocumentService";
import { mockSimilarity } from "./KnowledgeEmbeddingService";

export function searchKnowledge(query: string, limit = 5): SearchResult[] {
  if (!query.trim()) return [];

  return getDocuments()
    .map((document) => {
      const haystack = `${document.title} ${document.description} ${document.tags.join(" ")} ${document.category}`;
      const score = mockSimilarity(query, haystack);
      return {
        document,
        score,
        snippet: document.description,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}