// services/knowledge-loop/knowledge/ports.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. The dependency ports the
// KnowledgeService is written against, so the whole retrieval + lifecycle
// chain runs offline with in-memory adapters (AN1.9 MemoryStore precedent —
// `validate:knowledge-loop-*` never touches Postgres or Gemini).
//
// INV-1 (K1_DECISION §3): NO method here reads `KnowledgeCandidate`. Candidate
// storage exists only for tests (CandidateSeedPort) and is never wired into
// retrieval.

import type {
  KnowledgeRecord,
  KnowledgeChunkRecord,
  KnowledgeStatus,
  KnowledgeScope,
  CreateKnowledgeInput,
} from "@/types/knowledge-loop";

/** 768-d unit vector. Production wraps GeminiEmbeddingProvider; tests fake it. */
export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
}

export interface VectorHit {
  chunkId: string;
  knowledgeId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  similarity: number;
}

export interface VectorSearchQuery {
  embedding: number[];
  topK: number;
  scopes: string[];
  visibilities: string[];
  includeUserScope: boolean;
  callerUserId: string;
  knowledgeId?: string;
}

/**
 * Eligibility-filtered vector search. Production delegates to
 * `VectorRepository.searchSimilar` (the SQL-level INV-1 gate). The in-memory
 * adapter replays the same predicate in JS. Either way, this only ever
 * returns chunks that belong to a `Knowledge` row — never candidate content.
 */
export interface VectorSearchPort {
  searchSimilar(query: VectorSearchQuery): Promise<VectorHit[]>;
}

export interface KnowledgeListFilter {
  scope?: KnowledgeScope;
  lifecycleStatus?: KnowledgeStatus;
  knowledgeType?: string;
  supersededOnly?: boolean;
  includeDeleted?: boolean;
}

export interface TransitionInput {
  id: string;
  to: KnowledgeStatus;
  actorId: string;
  reason?: string;
  /** additional column patch applied in the same transaction. */
  patch?: Partial<
    Pick<
      KnowledgeRecord,
      | "approvedAt"
      | "approvedBy"
      | "deprecatedAt"
      | "deprecatedBy"
      | "lastReviewedAt"
      | "supersededById"
      | "confidence"
    >
  >;
}

export interface RetrievalLogEntry {
  userId: string;
  conversationId: string | null;
  queryHash: string;
  scopes: string[];
  hitCount: number;
  bestSimilarity: number | null;
  sufficiency: string;
  fromCache: boolean;
  latencyMs: number;
}

/**
 * Knowledge persistence + lifecycle. Every mutating method that changes what
 * retrieval would return MUST bump the KnowledgeVersionCounter in the SAME
 * transaction and return the new fingerprint (KNOWLEDGE_RETRIEVAL_CONTRACT §7.4).
 */
export interface KnowledgeStore {
  getById(id: string): Promise<KnowledgeRecord | null>;
  getByIds(ids: string[]): Promise<KnowledgeRecord[]>;
  getChunks(knowledgeIds: string[]): Promise<KnowledgeChunkRecord[]>;
  list(filter: KnowledgeListFilter): Promise<KnowledgeRecord[]>;

  create(input: CreateKnowledgeInput): Promise<KnowledgeRecord>;

  /** status transition + counter bump, atomic. */
  transition(
    input: TransitionInput,
  ): Promise<{ knowledge: KnowledgeRecord; versionFingerprint: string }>;

  /** publishNewVersion: new active row + old row → deprecated + counter bump, atomic. */
  createVersionOf(
    fromId: string,
    input: CreateKnowledgeInput,
  ): Promise<{
    created: KnowledgeRecord;
    deprecated: KnowledgeRecord;
    versionFingerprint: string;
  }>;

  getVersionFingerprint(): Promise<string>;

  /** best-effort — never throws into the retrieval path. */
  recordRetrieval(
    knowledgeIds: string[],
    log: RetrievalLogEntry,
  ): Promise<void>;
}

/**
 * TEST-ONLY seam. Lets a validate script put a `KnowledgeCandidate` into the
 * store so a test can PROVE it is never retrievable (INV-1 obligation 2).
 * The KnowledgeService does not depend on this — candidate lifecycle is K4.
 */
export interface CandidateSeedPort {
  seedCandidate(input: {
    id: string;
    canonicalQuestion: string;
    proposedAnswer: string;
    status: string;
  }): Promise<void>;
  listCandidateIds(): Promise<string[]>;
}
