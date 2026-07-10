// services/knowledge/KnowledgeIndexer.ts
// Indexing foundation. Simulates indexing a document: sets index + embedding
// status. A real indexer would chunk text, embed, and store vectors.

import type { KnowledgeDocument } from "@/types/knowledge";
import { getDocumentById, setStatus } from "./KnowledgeDocumentService";
import { embedDocument } from "./KnowledgeEmbeddingService";

export interface IndexResult {
  documentId: string;
  indexed: boolean;
  embeddingDimensions: number;
}

export async function indexDocument(id: string): Promise<IndexResult | null> {
  const doc: KnowledgeDocument | undefined = getDocumentById(id);
  if (!doc) return null;

  const embedding = await embedDocument(doc);
  setStatus(id, "indexed");

  return {
    documentId: id,
    indexed: true,
    embeddingDimensions: embedding.dimensions,
  };
}