// types/knowledge.ts
// AI Knowledge Base (RAG) — core types

import type { ProviderName } from "./provider-name";

export type DocumentStatus = "indexed" | "processing" | "pending" | "failed" | "archived";

export type EmbeddingStatus = "embedded" | "pending" | "processing" | "failed";

export type KnowledgeFileType = "md" | "pdf" | "txt" | "html" | "code";

export interface KnowledgeDocument {
  id: string;
  title: string;
  description: string;
  category: string;
  collection: string;
  author: string;
  tags: string[];
  provider: ProviderName;
  language: string;
  fileType: KnowledgeFileType;
  documentSize: number; // bytes
  createdAt: string;
  updatedAt: string;
  lastIndexed: string | null;
  status: DocumentStatus;
  embeddingStatus: EmbeddingStatus;
  retrievalCount: number;
  popularity: number; // 0–100
}

export interface KnowledgeCollection {
  id: string;
  name: string;
  description: string;
  documentCount: number;
}

export interface RetrievalRecord {
  id: string;
  query: string;
  documentId: string;
  documentTitle: string;
  retrievedAt: string;
  score: number; // 0–100 relevance
}

export interface SearchResult {
  document: KnowledgeDocument;
  score: number; // 0–100
  snippet: string;
}

export interface KnowledgeMetrics {
  totalDocuments: number;
  categories: number;
  collections: number;
  indexedDocuments: number;
  searchesToday: number;
  knowledgeHealth: number; // 0–100
  avgRetrievalMs: number;
  aiReferences: number;
}

/** Context assembled for a future RAG call. */
export interface KnowledgeContext {
  query: string;
  documents: SearchResult[];
  contextText: string;
}