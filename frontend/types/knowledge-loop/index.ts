// types/knowledge-loop/index.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: contract types.
// Mirrors the LOCKED contracts (docs/architecture/KNOWLEDGE_CONTRACT.md §3,
// KNOWLEDGE_RETRIEVAL_CONTRACT.md §3). Vendor-neutral; no `@relation` shapes.

import type {
  KnowledgeStatus,
  KnowledgeScope,
  KnowledgeVisibility,
  KnowledgeType,
  KnowledgeFreshnessClass,
  KnowledgeSourceType,
  CandidateStatus,
} from "@/lib/generated/prisma/enums";

export type {
  KnowledgeStatus,
  KnowledgeScope,
  KnowledgeVisibility,
  KnowledgeType,
  KnowledgeFreshnessClass,
  KnowledgeSourceType,
  CandidateStatus,
};

// ── Provenance (KNOWLEDGE_CONTRACT.md §3) ──────────────────────────────
// Shared shape for `Knowledge.provenance` and `KnowledgeCandidate.evidence`.
// NEVER a secret, an API key, or a raw provider payload.
export interface KnowledgeSourceRef {
  knowledgeId: string;
  chunkId: string;
  similarity: number;
}
export interface WebSourceRef {
  url: string;
  title: string;
  domain: string;
  retrievedAt: string;
  excerpt: string;
  relevance?: number;
}
export type ProvenanceOrigin =
  | "candidate"
  | "admin-authored"
  | "support-resolution"
  | "import"
  | "web-researched";
export interface KnowledgeProvenance {
  origin: ProvenanceOrigin;
  createdBy: string;
  createdAt: string;
  originatingConversationId?: string;
  originatingMessageId?: string;
  knowledgeSources?: KnowledgeSourceRef[];
  webSources?: WebSourceRef[];
  reviewerNotes?: string;
  editedByReviewer?: boolean;
}

// ── The subset of a `Knowledge` row the loop's service + retrieval need. ──
// A store adapter maps the real Prisma row (or an in-memory fixture) to this.
export interface KnowledgeRecord {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: string;
  canonicalQuestion: string | null;
  canonicalAnswer: string | null;
  knowledgeType: KnowledgeType | null;
  scope: KnowledgeScope;
  visibility: KnowledgeVisibility;
  source: string;
  sourceType: KnowledgeSourceType | null;
  provenance: KnowledgeProvenance | null;
  confidence: number | null;
  /** Legacy free-string column — untouched. */
  status: string;
  /** Knowledge Loop lifecycle. null for legacy scope=user rows. */
  lifecycleStatus: KnowledgeStatus | null;
  embeddingStatus: string;
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  freshnessClass: KnowledgeFreshnessClass | null;
  freshnessReviewEveryDays: number | null;
  expiresAt: Date | null;
  lastReviewedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  deprecatedAt: Date | null;
  deprecatedBy: string | null;
  retrievalCount: number;
  lastRetrievedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface KnowledgeChunkRecord {
  chunkId: string;
  knowledgeId: string;
  userId: string;
  chunkIndex: number;
  content: string;
}

// ── Retrieval (KNOWLEDGE_RETRIEVAL_CONTRACT.md §3) ─────────────────────
export type Sufficiency = "SUFFICIENT" | "LOW" | "INSUFFICIENT" | "STALE";

export interface RetrievalOptions {
  callerUserId: string;
  callerRole: string;
  /** e.g. ["assistant","shared"] for the AI Assistant; ["support","shared"] for Support. */
  scopes: KnowledgeScope[];
  topK?: number;
  knowledgeId?: string;
  /** default true — also search the caller's own scope=user rows. */
  includeUserScope?: boolean;
  /** best-effort — recorded on the KnowledgeRetrievalLog row. */
  conversationId?: string;
}

export interface RetrievalHit {
  knowledgeId: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  finalScore: number;
  authorityWeight: number;
  sourceType: KnowledgeSourceType | null;
  freshnessClass: KnowledgeFreshnessClass | null;
  scope: KnowledgeScope;
  stale: boolean;
  version: number;
  /** true for a scope=user row — the orchestrator must label it unverified. */
  unverified: boolean;
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  contextBlock: string;
  sufficiency: Sufficiency;
  conflict?: { aId: string; bId: string };
  bestSimilarity: number;
  fromCache: boolean;
  latencyMs: number;
  /** diagnostic — "empty-query" | "embedding-failed" | "below-threshold" | "ok". */
  reason: string;
}

// ── Lifecycle transitions (KNOWLEDGE_CONTRACT.md §4.4) ─────────────────
export interface TransitionResult {
  knowledge: KnowledgeRecord;
  /** monotonic KnowledgeVersionCounter value AFTER the transition. */
  versionFingerprint: string;
}

export interface NewVersionResult {
  created: KnowledgeRecord;
  deprecated: KnowledgeRecord;
  versionFingerprint: string;
}

export interface CreateKnowledgeInput {
  userId: string;
  title: string;
  description?: string;
  category?: string;
  canonicalQuestion?: string | null;
  canonicalAnswer?: string | null;
  knowledgeType: KnowledgeType;
  scope: KnowledgeScope;
  visibility?: KnowledgeVisibility;
  source: string;
  sourceType: KnowledgeSourceType;
  provenance: KnowledgeProvenance;
  confidence?: number | null;
  freshnessClass: KnowledgeFreshnessClass;
  freshnessReviewEveryDays?: number | null;
  expiresAt?: Date | null;
}
