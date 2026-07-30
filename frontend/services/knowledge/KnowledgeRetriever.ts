// services/knowledge/KnowledgeRetriever.ts
// Sprint L2.2 - retrieve() is now async (it calls the real search route).
// History starts empty - no fake seed data (the previous mockRetrievals
// import is removed; data/mock-knowledge.ts is deleted along with it).
// Also tracks real round-trip latency per search, so a genuine "avg
// retrieval time" metric can be shown instead of a hardcoded constant.
import type { SearchResult, RetrievalRecord } from "@/types/knowledge";
import { searchKnowledge } from "./KnowledgeSearchService";
import { KNOWLEDGE_CONFIG } from "@/config/knowledge.config";

let history: RetrievalRecord[] = [];
let latenciesMs: number[] = [];

export async function retrieve(query: string): Promise<SearchResult[]> {
  const startedAt = Date.now();
  const results = await searchKnowledge(query, KNOWLEDGE_CONFIG.maxContextDocuments);
  latenciesMs = [...latenciesMs, Date.now() - startedAt].slice(-50); // keep a rolling window

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

/** Real average of this session's actual search round-trip times. 0 until the first real search runs - never a placeholder number. */
export function getAverageLatencyMs(): number {
  if (latenciesMs.length === 0) return 0;
  return Math.round(latenciesMs.reduce((sum, ms) => sum + ms, 0) / latenciesMs.length);
}
