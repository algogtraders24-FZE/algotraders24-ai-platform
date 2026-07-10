// services/knowledge/KnowledgeEmbeddingService.ts
// Embedding foundation. Currently simulated. A future version generates real
// vector embeddings (e.g. via an embedding model) behind this same interface.

import type { KnowledgeDocument, EmbeddingStatus } from "@/types/knowledge";

export interface EmbeddingResult {
  documentId: string;
  status: EmbeddingStatus;
  dimensions: number;
}

/** Simulated embedding — returns an "embedded" result with mock dimensions. */
export async function embedDocument(doc: KnowledgeDocument): Promise<EmbeddingResult> {
  return {
    documentId: doc.id,
    status: "embedded",
    dimensions: 768, // typical embedding size; mock value
  };
}

/** Placeholder similarity: overlap of query terms with a text. 0–100. */
export function mockSimilarity(query: string, text: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (q.length === 0) return 0;
  const lower = text.toLowerCase();
  const hits = q.filter((term) => lower.includes(term)).length;
  return Math.round((hits / q.length) * 100);
}