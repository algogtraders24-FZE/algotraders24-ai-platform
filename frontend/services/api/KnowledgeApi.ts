// services/api/KnowledgeApi.ts
// Sprint 14E - Typed access to the knowledge private API route.
// Sprint L2.2 - added search() (the real vector search route) and
// uploadDocument() (real file upload - FormData, so it bypasses
// ApiClient's JSON-only get/post and calls fetch directly).
import { ApiClient, ApiClientError, type RequestOptions } from "./ApiClient";
import type { KnowledgeDocument, KnowledgeCollection } from "@/types/knowledge";

interface KnowledgeEnvelope {
  items: KnowledgeDocument[];
  collections: KnowledgeCollection[];
  total: number;
}

export interface KnowledgeSearchChunk {
  chunkId: string;
  knowledgeId: string;
  content: string;
  chunkIndex: number;
  similarity: number;
}

export interface UploadDocumentParams {
  file: File;
  title?: string;
  category?: string;
  collectionId?: string;
}

export interface UploadDocumentResult {
  document: KnowledgeDocument;
  chunksCreated: number;
  embeddingsStored: number;
  embeddingsFailed: number;
}

export interface ReindexResult {
  status: string;
  embeddingStatus: string;
  lastIndexed: string | null;
  chunksCreated: number;
  embeddingsStored: number;
  embeddingsFailed: number;
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

  static async search(query: string, topK: number): Promise<KnowledgeSearchChunk[]> {
    const data = await ApiClient.post<{ results: KnowledgeSearchChunk[]; total: number }>(
      "/api/private/knowledge/search",
      { query, topK },
    );
    return data.results;
  }

  /** Real multipart upload - not routed through ApiClient (JSON-only). */
  static async uploadDocument(params: UploadDocumentParams): Promise<UploadDocumentResult> {
    const form = new FormData();
    form.append("file", params.file);
    if (params.title) form.append("title", params.title);
    if (params.category) form.append("category", params.category);
    if (params.collectionId) form.append("collectionId", params.collectionId);

    const res = await fetch("/api/private/knowledge/upload", { method: "POST", body: form });
    const body = (await res.json().catch(() => null)) as
      | { status: "ok"; data: UploadDocumentResult }
      | { status: "error"; error: { code: string; message: string } }
      | null;

    if (!res.ok || !body || body.status === "error") {
      const err = body && body.status === "error" ? body.error : undefined;
      throw new ApiClientError(err?.code ?? "HTTP_ERROR", err?.message ?? "Upload failed", res.status);
    }
    this.invalidate();
    return body.data;
  }

  static async reindex(knowledgeId: string): Promise<ReindexResult> {
    const data = await ApiClient.post<ReindexResult>(`/api/private/knowledge/${encodeURIComponent(knowledgeId)}/reindex`, {});
    this.invalidate();
    return data;
  }
}