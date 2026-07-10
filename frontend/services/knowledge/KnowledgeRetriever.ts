// services/knowledge/KnowledgeRetriever.ts
// Retrieves the most relevant documents for a query and records the retrieval.

import type { SearchResult, RetrievalRecord } from "@/types/knowledge";
import { searchKnowledge } from "./KnowledgeSearchService";
import { mockRetrievals } from "@/data/mock-knowledge";
import { KNOWLEDGE_CONFIG } from "@/config/knowledge.config";

let history: RetrievalRecord[] = [...mockRetrievals];

export function retrieve(query: string): SearchResult[] {
  const results = searchKnowledge(query, KNOWLEDGE_CONFIG.maxContextDocuments);

  results.forEach((r, i) => {
    history = [
      {
        id: `ret-${Date.now()}-${i}`,
        query,
        documentId: r.document.id,
        documentTitle: r.document.title,
        retrievedAt: new Date().toISOString(),
        score: r.score,
      },
      ...history,
    ];
  });

  return results;
}

export function getRetrievalHistory(): RetrievalRecord[] {
  return history;
}