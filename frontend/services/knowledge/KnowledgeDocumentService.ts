// services/knowledge/KnowledgeDocumentService.ts
// Repository-style access to knowledge documents. Swap the mock source for a
// database later without changing callers.

import type { KnowledgeDocument, DocumentStatus } from "@/types/knowledge";
import { mockDocuments } from "@/data/mock-knowledge";

let documents: KnowledgeDocument[] = [...mockDocuments];

export function getDocuments(): KnowledgeDocument[] {
  return documents;
}

export function getDocumentById(id: string): KnowledgeDocument | undefined {
  return documents.find((d) => d.id === id);
}

export function getByCategory(category: string): KnowledgeDocument[] {
  return documents.filter((d) => d.category === category);
}

export function getByCollection(collection: string): KnowledgeDocument[] {
  return documents.filter((d) => d.collection === collection);
}

export function addDocument(doc: KnowledgeDocument): void {
  documents = [doc, ...documents];
}

export function setStatus(id: string, status: DocumentStatus): KnowledgeDocument | undefined {
  documents = documents.map((d) => (d.id === id ? { ...d, status } : d));
  return getDocumentById(id);
}