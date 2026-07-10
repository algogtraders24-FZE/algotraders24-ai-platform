// services/knowledge/KnowledgeCollectionService.ts
// Access to knowledge collections.

import type { KnowledgeCollection } from "@/types/knowledge";
import { mockCollections } from "@/data/mock-knowledge";
import { getByCollection } from "./KnowledgeDocumentService";

export function getCollections(): KnowledgeCollection[] {
  return mockCollections.map((c) => ({
    ...c,
    documentCount: getByCollection(c.name).length,
  }));
}

export function getCollectionByName(name: string): KnowledgeCollection | undefined {
  return getCollections().find((c) => c.name === name);
}