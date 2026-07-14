// services/api/KnowledgeApi.ts
// Sprint 14E - Typed access to the knowledge private API route.
import { ApiClient, type RequestOptions } from "./ApiClient";
import type { KnowledgeDocument, KnowledgeCollection } from "@/types/knowledge";

interface KnowledgeEnvelope {
  items: KnowledgeDocument[];
  collections: KnowledgeCollection[];
  total: number;
}

const KNOWLEDGE_TTL_MS = 30 * 1000;

export class KnowledgeApi {
  static async load(options: RequestOptions = {}): Promise<KnowledgeEnvelope> {
    return ApiClient.get<KnowledgeEnvelope>("/api/private/knowledge", {
      cacheTtlMs: KNOWLEDGE_TTL_MS,
      retries: 2,
      ...options,
    });
  }

  static invalidate(): void {
    ApiClient.invalidate("/api/private/knowledge");
  }
}