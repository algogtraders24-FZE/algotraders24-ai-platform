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
  KnowledgeRecord,
  KnowledgeScope,
  KnowledgeSourceType,
  KnowledgeType,
  KnowledgeVisibility,
} from "@/types/knowledge-loop";

export type { EmbeddingPort, VectorSearchPort, VectorSearchQuery, VectorHit } from "../knowledge/ports";

// ── K4.2-C Phase 1 — lifecycle analytics (KNOWLEDGE_ANALYTICS_CONTRACT.md
//    §2.2/§4). Optional on both services' deps — omitting it is a no-op, so
//    K4.2-A's and K4.2-B's own test files are unaffected by this addition
//    (K4.2C_PHASE1_ADMIN_GOVERNANCE.md §2). ──
export interface AnalyticsPort {
  record(userId: string | null, type: string, metadata?: Record<string, unknown>): Promise<void>;
}

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

// ── K4.2-B — governance approval (K4.2B_GOVERNANCE_APPROVAL.md) ───────────

export interface ApproveCandidateStoreInput {
  candidateId: string;
  adminId: string;
  knowledge: {
    userId: string;
    title: string;
    description: string;
    category: string;
    canonicalQuestion: string;
    canonicalAnswer: string;
    knowledgeType: KnowledgeType;
    scope: KnowledgeScope;
    visibility: KnowledgeVisibility;
    source: string;
    sourceType: KnowledgeSourceType;
    provenance: KnowledgeProvenance;
    confidence: number;
    freshnessClass: KnowledgeFreshnessClass;
    freshnessReviewEveryDays: number | null;
    expiresAt: Date | null;
  };
  auditMetadata: Record<string, unknown>;
}

export interface ApproveCandidateStoreResult {
  /** "ok" | the candidate wasn't in {candidate, under_review} (race or
   *  already-decided) | the candidate id doesn't exist. */
  outcome: "ok" | "wrong-status" | "not-found";
  knowledge?: KnowledgeRecord;
  candidate?: CandidateRecord;
  auditLogId?: string;
  versionFingerprint?: string;
}

export interface RejectCandidateStoreInput {
  candidateId: string;
  adminId: string;
  reason: string;
  closeAs: "rejected" | "duplicate" | "superseded";
  auditMetadata: Record<string, unknown>;
}

export interface RejectCandidateStoreResult {
  outcome: "ok" | "wrong-status" | "not-found";
  candidate?: CandidateRecord;
  auditLogId?: string;
}

export interface TransitionKnowledgeStoreInput {
  knowledgeId: string;
  /** the status(es) this transition is valid FROM — enforced as a
   *  conditional update, race-safe (K4.2B-D3). */
  fromStatuses: string[];
  to: "deprecated" | "archived" | "active";
  adminId: string;
  reason?: string;
  action: string;
  auditMetadata: Record<string, unknown>;
}

export interface TransitionKnowledgeStoreResult {
  outcome: "ok" | "wrong-status" | "not-found";
  knowledge?: KnowledgeRecord;
  auditLogId?: string;
  versionFingerprint?: string;
}

export interface PublishNewVersionStoreInput {
  fromKnowledgeId: string;
  adminId: string;
  newFields: {
    userId: string;
    title: string;
    description: string;
    category: string;
    canonicalQuestion: string;
    canonicalAnswer: string;
    knowledgeType: KnowledgeType;
    scope: KnowledgeScope;
    visibility: KnowledgeVisibility;
    source: string;
    sourceType: KnowledgeSourceType;
    provenance: KnowledgeProvenance;
    confidence: number;
    freshnessClass: KnowledgeFreshnessClass;
    freshnessReviewEveryDays: number | null;
    expiresAt: Date | null;
  };
  reason: string;
  auditMetadata: Record<string, unknown>;
}

export interface PublishNewVersionStoreResult {
  outcome: "ok" | "not-found";
  created?: KnowledgeRecord;
  deprecated?: KnowledgeRecord;
  auditLogId?: string;
  versionFingerprint?: string;
}

export interface GovernanceStorePort {
  isAdmin(userId: string): Promise<boolean>;
  getCandidateById(id: string): Promise<CandidateRecord | null>;
  getKnowledgeById(id: string): Promise<KnowledgeRecord | null>;
  approveCandidate(input: ApproveCandidateStoreInput): Promise<ApproveCandidateStoreResult>;
  rejectCandidate(input: RejectCandidateStoreInput): Promise<RejectCandidateStoreResult>;
  transitionKnowledge(input: TransitionKnowledgeStoreInput): Promise<TransitionKnowledgeStoreResult>;
  publishNewVersion(input: PublishNewVersionStoreInput): Promise<PublishNewVersionStoreResult>;
}
