// services/knowledge-loop/governance/ports.ts
// Sprint K4.2-A — AT24 Knowledge Governance: candidate-capture ports.
// Mirrors services/knowledge-loop/knowledge/ports.ts's DI pattern.
//
// `CandidateStorePort` is the ONLY seam that writes `KnowledgeCandidate`.
// `EmbeddingPort`/`VectorSearchPort` are NOT redefined here — governance
// reuses the exact same interfaces + production adapters the retrieval layer
// already uses (no second embedding provider, no new vector-search code,
// K4.2A_CANDIDATE_CAPTURE.md §2.4).

import type {
  CandidateReason,
  CandidateRecord,
  CandidateStatus,
  KnowledgeFreshnessClass,
  KnowledgeProvenance,
  KnowledgeScope,
  KnowledgeSourceType,
  KnowledgeType,
  KnowledgeVisibility,
} from "@/types/knowledge-loop";

export type { EmbeddingPort, VectorSearchPort, VectorSearchQuery, VectorHit } from "../knowledge/ports";

/** everything `CandidateService.propose()` needs to insert one row. */
export interface CreateCandidateInput {
  createdByUserId: string;
  originatingConversationId: string | null;
  originatingMessageId: string | null;
  canonicalQuestion: string;
  proposedAnswer: string;
  knowledgeType: KnowledgeType;
  proposedScope: KnowledgeScope;
  proposedVisibility: KnowledgeVisibility;
  proposedFreshnessClass: KnowledgeFreshnessClass;
  sourceType: KnowledgeSourceType;
  evidence: KnowledgeProvenance;
  confidence: number;
  reasonForCandidate: CandidateReason;
  duplicateOfId: string | null;
  similarityScore: number | null;
  status: CandidateStatus;
}

export interface CandidateStorePort {
  create(input: CreateCandidateInput): Promise<CandidateRecord>;
  /** idempotency lookup 1/2 (K4.2A-D3) — the common case, O(indexed lookup). */
  findByOriginatingMessage(
    sourceType: string,
    originatingMessageId: string,
  ): Promise<CandidateRecord | null>;
  /** idempotency lookup 2/2 — fallback when no message id exists. */
  findByExactContent(
    createdByUserId: string,
    sourceType: string,
    canonicalQuestion: string,
    proposedAnswer: string,
  ): Promise<CandidateRecord | null>;
}
