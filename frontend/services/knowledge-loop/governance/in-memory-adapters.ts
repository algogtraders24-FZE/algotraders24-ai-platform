// services/knowledge-loop/governance/in-memory-adapters.ts
// Sprint K4.2-A/B — AT24 Knowledge Governance: offline test doubles.
// `validate-k4.2a-candidate-capture.ts` / `validate-k4.2b-governance-approval.ts`
// run entirely against these — no DB, no embedding API, no network (K1/K2/K3
// precedent).

import type { CandidateRecord, KnowledgeRecord } from "@/types/knowledge-loop";
import type {
  ApproveCandidateStoreInput,
  ApproveCandidateStoreResult,
  CandidateStorePort,
  CreateCandidateInput,
  EmbeddingPort,
  GovernanceStorePort,
  PublishNewVersionStoreInput,
  PublishNewVersionStoreResult,
  RejectCandidateStoreInput,
  RejectCandidateStoreResult,
  TransitionKnowledgeStoreInput,
  TransitionKnowledgeStoreResult,
  VectorHit,
  VectorSearchPort,
  VectorSearchQuery,
} from "./ports";
import type { IngestionPort, IngestOutcome } from "../knowledge/ingestion-adapter";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class InMemoryCandidateStore implements CandidateStorePort {
  rows: CandidateRecord[] = [];

  async create(input: CreateCandidateInput): Promise<CandidateRecord> {
    const now = new Date();
    const row: CandidateRecord = {
      id: nextId("cand"),
      createdByUserId: input.createdByUserId,
      originatingConversationId: input.originatingConversationId,
      originatingMessageId: input.originatingMessageId,
      canonicalQuestion: input.canonicalQuestion,
      proposedAnswer: input.proposedAnswer,
      knowledgeType: input.knowledgeType,
      proposedScope: input.proposedScope,
      proposedVisibility: input.proposedVisibility,
      proposedFreshnessClass: input.proposedFreshnessClass,
      sourceType: input.sourceType,
      evidence: input.evidence,
      confidence: input.confidence,
      reasonForCandidate: input.reasonForCandidate,
      duplicateOfId: input.duplicateOfId,
      similarityScore: input.similarityScore,
      status: input.status,
      assignedReviewerId: null,
      reviewedAt: null,
      reviewNotes: null,
      finalKnowledgeId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findByOriginatingMessage(
    sourceType: string,
    originatingMessageId: string,
  ): Promise<CandidateRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.deletedAt === null &&
          r.sourceType === sourceType &&
          r.originatingMessageId === originatingMessageId,
      ) ?? null
    );
  }

  async findByExactContent(
    createdByUserId: string,
    sourceType: string,
    canonicalQuestion: string,
    proposedAnswer: string,
  ): Promise<CandidateRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.deletedAt === null &&
          r.createdByUserId === createdByUserId &&
          r.sourceType === sourceType &&
          r.canonicalQuestion === canonicalQuestion &&
          r.proposedAnswer === proposedAnswer,
      ) ?? null
    );
  }
}

export interface FakeEmbedderConfig {
  /** deterministic vector to return, or a fn keyed on the input text. */
  embedding?: number[] | ((text: string) => number[]);
  throwError?: boolean;
}

export class FakeEmbedder implements EmbeddingPort {
  calls: string[] = [];
  constructor(private cfg: FakeEmbedderConfig = {}) {}

  async embed(text: string): Promise<number[]> {
    this.calls.push(text);
    if (this.cfg.throwError) throw new Error("fake-embedder-down");
    if (typeof this.cfg.embedding === "function") return this.cfg.embedding(text);
    return this.cfg.embedding ?? new Array(768).fill(0);
  }
}

export interface FakeVectorSearchConfig {
  hits?: Partial<VectorHit>[];
}

export class FakeVectorSearch implements VectorSearchPort {
  calls: VectorSearchQuery[] = [];
  constructor(private cfg: FakeVectorSearchConfig = {}) {}

  set(cfg: FakeVectorSearchConfig): void {
    this.cfg = cfg;
  }

  async searchSimilar(query: VectorSearchQuery): Promise<VectorHit[]> {
    this.calls.push(query);
    return (this.cfg.hits ?? []).map((h, i) => ({
      chunkId: h.chunkId ?? `c${i}`,
      knowledgeId: h.knowledgeId ?? `k${i}`,
      userId: h.userId ?? "u1",
      content: h.content ?? "fixture chunk",
      chunkIndex: h.chunkIndex ?? 0,
      similarity: h.similarity ?? 0,
    }));
  }
}

// ── K4.2-B — governance approval test doubles ──────────────────────────

export interface AuditLogRow {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export class InMemoryGovernanceStore implements GovernanceStorePort {
  knowledgeRows: KnowledgeRecord[] = [];
  auditLog: AuditLogRow[] = [];
  adminIds = new Set<string>();
  private counter = 0;

  constructor(private candidates: InMemoryCandidateStore) {}

  private bumpCounter(): string {
    this.counter += 1;
    return String(this.counter);
  }

  private writeAudit(actorUserId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>): string {
    const id = nextId("audit");
    this.auditLog.push({ id, actorUserId, action, targetType, targetId, metadata, createdAt: new Date() });
    return id;
  }

  async isAdmin(userId: string): Promise<boolean> {
    return this.adminIds.has(userId);
  }

  async getCandidateById(id: string): Promise<CandidateRecord | null> {
    return this.candidates.rows.find((r) => r.id === id && r.deletedAt === null) ?? null;
  }

  async getKnowledgeById(id: string): Promise<KnowledgeRecord | null> {
    return this.knowledgeRows.find((r) => r.id === id && r.deletedAt === null) ?? null;
  }

  async approveCandidate(input: ApproveCandidateStoreInput): Promise<ApproveCandidateStoreResult> {
    // conditional-update semantics (K4.2B-D3): find the row that is STILL
    // approvable at the moment of write, not merely was approvable when the
    // caller last read it.
    const idx = this.candidates.rows.findIndex(
      (r) => r.id === input.candidateId && r.deletedAt === null,
    );
    if (idx === -1) return { outcome: "not-found" };
    const candidate = this.candidates.rows[idx];
    if (candidate.status !== "candidate" && candidate.status !== "under_review") {
      return { outcome: "wrong-status", candidate };
    }

    const now = new Date();
    const knowledge: KnowledgeRecord = {
      id: nextId("know"),
      userId: input.knowledge.userId,
      title: input.knowledge.title,
      description: input.knowledge.description,
      category: input.knowledge.category,
      canonicalQuestion: input.knowledge.canonicalQuestion,
      canonicalAnswer: input.knowledge.canonicalAnswer,
      knowledgeType: input.knowledge.knowledgeType,
      scope: input.knowledge.scope,
      visibility: input.knowledge.visibility,
      source: input.knowledge.source,
      sourceType: input.knowledge.sourceType,
      provenance: input.knowledge.provenance,
      confidence: input.knowledge.confidence,
      status: "processing",  // legacy free-string column, untouched — matches schema default
      lifecycleStatus: "active",
      embeddingStatus: "pending",
      version: 1,
      supersedesId: null,
      supersededById: null,
      freshnessClass: input.knowledge.freshnessClass,
      freshnessReviewEveryDays: input.knowledge.freshnessReviewEveryDays,
      expiresAt: input.knowledge.expiresAt,
      lastReviewedAt: now,
      approvedAt: now,
      approvedBy: input.adminId,
      deprecatedAt: null,
      deprecatedBy: null,
      retrievalCount: 0,
      lastRetrievedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.knowledgeRows.push(knowledge);

    const updatedCandidate: CandidateRecord = {
      ...candidate,
      status: "approved",
      finalKnowledgeId: knowledge.id,
      reviewedAt: now,
      assignedReviewerId: input.adminId,
      updatedAt: now,
    };
    this.candidates.rows[idx] = updatedCandidate;

    const versionFingerprint = this.bumpCounter();
    const auditLogId = this.writeAudit(input.adminId, "knowledge.approve", "KnowledgeCandidate", input.candidateId, {
      ...input.auditMetadata,
      knowledgeId: knowledge.id,
      version: knowledge.version,
      after: knowledge,
    });

    return { outcome: "ok", knowledge, candidate: updatedCandidate, auditLogId, versionFingerprint };
  }

  async rejectCandidate(input: RejectCandidateStoreInput): Promise<RejectCandidateStoreResult> {
    const idx = this.candidates.rows.findIndex(
      (r) => r.id === input.candidateId && r.deletedAt === null,
    );
    if (idx === -1) return { outcome: "not-found" };
    const candidate = this.candidates.rows[idx];
    if (candidate.status !== "candidate" && candidate.status !== "under_review") {
      return { outcome: "wrong-status", candidate };
    }
    const now = new Date();
    const updated: CandidateRecord = {
      ...candidate,
      status: input.closeAs,
      reviewNotes: input.reason,
      reviewedAt: now,
      assignedReviewerId: input.adminId,
      updatedAt: now,
    };
    this.candidates.rows[idx] = updated;
    const auditLogId = this.writeAudit(input.adminId, "knowledge.reject", "KnowledgeCandidate", input.candidateId, {
      ...input.auditMetadata,
      candidateSnapshot: candidate,
    });
    return { outcome: "ok", candidate: updated, auditLogId };
  }

  async transitionKnowledge(input: TransitionKnowledgeStoreInput): Promise<TransitionKnowledgeStoreResult> {
    const idx = this.knowledgeRows.findIndex((r) => r.id === input.knowledgeId && r.deletedAt === null);
    if (idx === -1) return { outcome: "not-found" };
    const row = this.knowledgeRows[idx];
    if (!input.fromStatuses.includes(row.lifecycleStatus ?? "")) {
      return { outcome: "wrong-status", knowledge: row };
    }
    const now = new Date();
    const updated: KnowledgeRecord = {
      ...row,
      lifecycleStatus: input.to,
      ...(input.to === "deprecated" ? { deprecatedAt: now, deprecatedBy: input.adminId } : {}),
      ...(input.to === "active" ? { deprecatedAt: null, deprecatedBy: null } : {}),
      updatedAt: now,
    };
    this.knowledgeRows[idx] = updated;
    const versionFingerprint = this.bumpCounter();
    const auditLogId = this.writeAudit(input.adminId, input.action, "Knowledge", input.knowledgeId, {
      ...input.auditMetadata,
      before: row,
      after: updated,
    });
    return { outcome: "ok", knowledge: updated, auditLogId, versionFingerprint };
  }

  async publishNewVersion(input: PublishNewVersionStoreInput): Promise<PublishNewVersionStoreResult> {
    const idx = this.knowledgeRows.findIndex((r) => r.id === input.fromKnowledgeId && r.deletedAt === null);
    if (idx === -1) return { outcome: "not-found" };
    const prev = this.knowledgeRows[idx];
    // mirrors the real PrismaGovernanceStore's conditional updateMany
    // (lifecycleStatus: "active") — a non-active source row is reported the
    // same way as not-found (K4.2B_GOVERNANCE_APPROVAL.md §2 design note).
    if (prev.lifecycleStatus !== "active") return { outcome: "not-found" };
    const now = new Date();
    const created: KnowledgeRecord = {
      id: nextId("know"),
      userId: input.newFields.userId,
      title: input.newFields.title,
      description: input.newFields.description,
      category: input.newFields.category,
      canonicalQuestion: input.newFields.canonicalQuestion,
      canonicalAnswer: input.newFields.canonicalAnswer,
      knowledgeType: input.newFields.knowledgeType,
      scope: input.newFields.scope,
      visibility: input.newFields.visibility,
      source: input.newFields.source,
      sourceType: input.newFields.sourceType,
      provenance: input.newFields.provenance,
      confidence: input.newFields.confidence,
      status: "processing",  // legacy free-string column, untouched — matches schema default
      lifecycleStatus: "active",
      embeddingStatus: "pending",
      version: prev.version + 1,
      supersedesId: prev.id,
      supersededById: null,
      freshnessClass: input.newFields.freshnessClass,
      freshnessReviewEveryDays: input.newFields.freshnessReviewEveryDays,
      expiresAt: input.newFields.expiresAt,
      lastReviewedAt: now,
      approvedAt: now,
      approvedBy: input.adminId,
      deprecatedAt: null,
      deprecatedBy: null,
      retrievalCount: 0,
      lastRetrievedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const deprecated: KnowledgeRecord = {
      ...prev,
      lifecycleStatus: "deprecated",
      supersededById: created.id,
      deprecatedAt: now,
      updatedAt: now,
    };
    this.knowledgeRows.push(created);
    this.knowledgeRows[idx] = deprecated;
    const versionFingerprint = this.bumpCounter();
    const auditLogId = this.writeAudit(input.adminId, "knowledge.new_version", "Knowledge", created.id, {
      ...input.auditMetadata,
      previousVersionId: prev.id,
      version: created.version,
      before: prev,
      after: created,
    });
    return { outcome: "ok", created, deprecated, auditLogId, versionFingerprint };
  }
}

export interface FakeIngestionConfig {
  chunksCreated?: number;
  embeddingsStored?: number;
  embeddingsFailed?: number;
  throwError?: boolean;
}

export class FakeIngestionPort implements IngestionPort {
  calls: Array<{ knowledgeId: string; userId: string; text: string }> = [];
  constructor(private cfg: FakeIngestionConfig = {}) {}

  async ingest(params: { knowledgeId: string; userId: string; text: string }): Promise<IngestOutcome> {
    this.calls.push(params);
    if (this.cfg.throwError) throw new Error("fake-ingestion-down");
    return {
      knowledgeId: params.knowledgeId,
      chunksCreated: this.cfg.chunksCreated ?? 1,
      embeddingsStored: this.cfg.embeddingsStored ?? 1,
      embeddingsFailed: this.cfg.embeddingsFailed ?? 0,
    };
  }

  async reembed(knowledgeId: string): Promise<IngestOutcome> {
    return { knowledgeId, chunksCreated: 1, embeddingsStored: 1, embeddingsFailed: 0 };
  }
}
