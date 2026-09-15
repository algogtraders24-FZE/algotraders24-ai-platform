// services/knowledge-loop/governance/prisma-adapters.ts
// Sprint K4.2-A — AT24 Knowledge Governance: production candidate store.
// Touches ONLY `prisma.knowledgeCandidate` — never `prisma.knowledge` or
// `prisma.knowledgeChunk` (K4.2A-D4, the governance boundary).
//
// Sprint K4.2-B adds `PrismaGovernanceStore` in the same file — THIS is the
// one sanctioned place `prisma.knowledge.*` mutations and `prisma.auditLog.*`
// writes happen for a governance transition (K4.2B-D1/D4). It does NOT call
// `KnowledgeService`/`PrismaKnowledgeStore` — see K4.2B_GOVERNANCE_APPROVAL.md
// §2 for why: true cross-table atomicity (Knowledge + KnowledgeCandidate +
// AuditLog + KnowledgeVersionCounter, one transaction) needs a single
// `prisma.$transaction` this module owns end-to-end.

import { prisma } from "@/lib/prisma";
import type {
  CandidateRecord,
  KnowledgeProvenance,
  KnowledgeRecord,
} from "@/types/knowledge-loop";
import type {
  ApproveCandidateStoreInput,
  ApproveCandidateStoreResult,
  CandidateStorePort,
  CreateCandidateInput,
  GovernanceStorePort,
  PublishNewVersionStoreInput,
  PublishNewVersionStoreResult,
  RejectCandidateStoreInput,
  RejectCandidateStoreResult,
  TransitionKnowledgeStoreInput,
  TransitionKnowledgeStoreResult,
} from "./ports";

const VERSION_COUNTER_ID = "singleton";

function toRecord(row: {
  id: string;
  createdByUserId: string;
  originatingConversationId: string | null;
  originatingMessageId: string | null;
  canonicalQuestion: string;
  proposedAnswer: string;
  knowledgeType: string;
  proposedScope: string;
  proposedVisibility: string;
  proposedFreshnessClass: string;
  sourceType: string;
  evidence: unknown;
  confidence: number;
  reasonForCandidate: string;
  duplicateOfId: string | null;
  similarityScore: number | null;
  status: string;
  assignedReviewerId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  finalKnowledgeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): CandidateRecord {
  return {
    ...row,
    knowledgeType: row.knowledgeType as CandidateRecord["knowledgeType"],
    proposedScope: row.proposedScope as CandidateRecord["proposedScope"],
    proposedVisibility: row.proposedVisibility as CandidateRecord["proposedVisibility"],
    proposedFreshnessClass:
      row.proposedFreshnessClass as CandidateRecord["proposedFreshnessClass"],
    sourceType: row.sourceType as CandidateRecord["sourceType"],
    status: row.status as CandidateRecord["status"],
    evidence: row.evidence as KnowledgeProvenance,
  };
}

export class PrismaCandidateStore implements CandidateStorePort {
  async create(input: CreateCandidateInput): Promise<CandidateRecord> {
    const row = await prisma.knowledgeCandidate.create({
      data: {
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
        evidence: input.evidence as unknown as object,
        confidence: input.confidence,
        reasonForCandidate: input.reasonForCandidate,
        duplicateOfId: input.duplicateOfId,
        similarityScore: input.similarityScore,
        status: input.status,
      },
    });
    return toRecord(row);
  }

  async findByOriginatingMessage(
    sourceType: string,
    originatingMessageId: string,
  ): Promise<CandidateRecord | null> {
    const row = await prisma.knowledgeCandidate.findFirst({
      where: {
        sourceType: sourceType as never,
        originatingMessageId,
        deletedAt: null,
      },
    });
    return row ? toRecord(row) : null;
  }

  async findByExactContent(
    createdByUserId: string,
    sourceType: string,
    canonicalQuestion: string,
    proposedAnswer: string,
  ): Promise<CandidateRecord | null> {
    const row = await prisma.knowledgeCandidate.findFirst({
      where: {
        createdByUserId,
        sourceType: sourceType as never,
        canonicalQuestion,
        proposedAnswer,
        deletedAt: null,
      },
    });
    return row ? toRecord(row) : null;
  }
}

// ── K4.2-B — governance store ──────────────────────────────────────────

function toKnowledgeRecord(row: {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: string;
  canonicalQuestion: string | null;
  canonicalAnswer: string | null;
  knowledgeType: string | null;
  scope: string;
  visibility: string;
  source: string;
  sourceType: string | null;
  provenance: unknown;
  confidence: number | null;
  status: string;
  lifecycleStatus: string | null;
  embeddingStatus: string;
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  freshnessClass: string | null;
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
}): KnowledgeRecord {
  return {
    ...row,
    knowledgeType: row.knowledgeType as KnowledgeRecord["knowledgeType"],
    scope: row.scope as KnowledgeRecord["scope"],
    visibility: row.visibility as KnowledgeRecord["visibility"],
    sourceType: row.sourceType as KnowledgeRecord["sourceType"],
    freshnessClass: row.freshnessClass as KnowledgeRecord["freshnessClass"],
    lifecycleStatus: row.lifecycleStatus as KnowledgeRecord["lifecycleStatus"],
    provenance: (row.provenance as KnowledgeProvenance | null) ?? null,
  };
}

/** thrown INSIDE a `prisma.$transaction` callback to force a full rollback
 *  when a conditional update's affected-row count isn't 1 — the caller
 *  re-reads OUTSIDE the (now rolled-back) transaction to report whether it
 *  was not-found or wrong-status (K4.2B-D3, race-safe by construction: the
 *  conditional update is the ONLY status check that matters). */
class GovernanceConflictError extends Error {}

export class PrismaGovernanceStore implements GovernanceStorePort {
  async isAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return user?.role === "admin";
  }

  async getCandidateById(id: string): Promise<CandidateRecord | null> {
    const row = await prisma.knowledgeCandidate.findUnique({ where: { id } });
    return row && row.deletedAt === null ? toRecord(row) : null;
  }

  async getKnowledgeById(id: string): Promise<KnowledgeRecord | null> {
    const row = await prisma.knowledge.findUnique({ where: { id } });
    return row && row.deletedAt === null ? toKnowledgeRecord(row) : null;
  }

  async approveCandidate(input: ApproveCandidateStoreInput): Promise<ApproveCandidateStoreResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const knowledgeRow = await tx.knowledge.create({
          data: {
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
            provenance: input.knowledge.provenance as unknown as object,
            confidence: input.knowledge.confidence,
            lifecycleStatus: "active",
            version: 1,
            freshnessClass: input.knowledge.freshnessClass,
            freshnessReviewEveryDays: input.knowledge.freshnessReviewEveryDays,
            expiresAt: input.knowledge.expiresAt,
            lastReviewedAt: now,
            approvedAt: now,
            approvedBy: input.adminId,
          },
        });

        // the ONE race-safe status check — conditional update, not a plain
        // read-then-write (K4.2B-D3).
        const updateResult = await tx.knowledgeCandidate.updateMany({
          where: {
            id: input.candidateId,
            status: { in: ["candidate", "under_review"] },
            deletedAt: null,
          },
          data: {
            status: "approved",
            finalKnowledgeId: knowledgeRow.id,
            reviewedAt: now,
            assignedReviewerId: input.adminId,
          },
        });
        if (updateResult.count !== 1) {
          throw new GovernanceConflictError(input.candidateId);
        }

        const candidateRow = await tx.knowledgeCandidate.findUniqueOrThrow({
          where: { id: input.candidateId },
        });
        const counter = await tx.knowledgeVersionCounter.upsert({
          where: { id: VERSION_COUNTER_ID },
          create: { id: VERSION_COUNTER_ID, value: BigInt(1) },
          update: { value: { increment: BigInt(1) } },
        });
        const knowledge = toKnowledgeRecord(knowledgeRow);
        const auditRow = await tx.auditLog.create({
          data: {
            actorUserId: input.adminId,
            action: "knowledge.approve",
            targetType: "KnowledgeCandidate",
            targetId: input.candidateId,
            metadata: {
              ...input.auditMetadata,
              knowledgeId: knowledgeRow.id,
              version: 1,
              after: knowledge as unknown as object,
            } as object,
          },
        });

        return {
          outcome: "ok" as const,
          knowledge,
          candidate: toRecord(candidateRow),
          auditLogId: auditRow.id,
          versionFingerprint: counter.value.toString(),
        };
      });
    } catch (err) {
      if (err instanceof GovernanceConflictError) {
        const existing = await prisma.knowledgeCandidate.findUnique({ where: { id: input.candidateId } });
        if (!existing) return { outcome: "not-found" };
        return { outcome: "wrong-status", candidate: toRecord(existing) };
      }
      throw err;
    }
  }

  async rejectCandidate(input: RejectCandidateStoreInput): Promise<RejectCandidateStoreResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const updateResult = await tx.knowledgeCandidate.updateMany({
          where: {
            id: input.candidateId,
            status: { in: ["candidate", "under_review"] },
            deletedAt: null,
          },
          data: {
            status: input.closeAs,
            reviewNotes: input.reason,
            reviewedAt: now,
            assignedReviewerId: input.adminId,
          },
        });
        if (updateResult.count !== 1) {
          throw new GovernanceConflictError(input.candidateId);
        }
        const candidateRow = await tx.knowledgeCandidate.findUniqueOrThrow({
          where: { id: input.candidateId },
        });
        const auditRow = await tx.auditLog.create({
          data: {
            actorUserId: input.adminId,
            action: "knowledge.reject",
            targetType: "KnowledgeCandidate",
            targetId: input.candidateId,
            metadata: { ...input.auditMetadata } as object,
          },
        });
        return { outcome: "ok" as const, candidate: toRecord(candidateRow), auditLogId: auditRow.id };
      });
    } catch (err) {
      if (err instanceof GovernanceConflictError) {
        const existing = await prisma.knowledgeCandidate.findUnique({ where: { id: input.candidateId } });
        if (!existing) return { outcome: "not-found" };
        return { outcome: "wrong-status", candidate: toRecord(existing) };
      }
      throw err;
    }
  }

  async transitionKnowledge(input: TransitionKnowledgeStoreInput): Promise<TransitionKnowledgeStoreResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const patch: Record<string, unknown> = { lifecycleStatus: input.to };
        if (input.to === "deprecated") {
          patch.deprecatedAt = now;
          patch.deprecatedBy = input.adminId;
        }
        if (input.to === "active") {
          patch.deprecatedAt = null;
          patch.deprecatedBy = null;
        }
        const updateResult = await tx.knowledge.updateMany({
          where: {
            id: input.knowledgeId,
            lifecycleStatus: { in: input.fromStatuses as never[] },
            deletedAt: null,
          },
          data: patch as never,
        });
        if (updateResult.count !== 1) {
          throw new GovernanceConflictError(input.knowledgeId);
        }
        const row = await tx.knowledge.findUniqueOrThrow({ where: { id: input.knowledgeId } });
        const counter = await tx.knowledgeVersionCounter.upsert({
          where: { id: VERSION_COUNTER_ID },
          create: { id: VERSION_COUNTER_ID, value: BigInt(1) },
          update: { value: { increment: BigInt(1) } },
        });
        const knowledge = toKnowledgeRecord(row);
        const auditRow = await tx.auditLog.create({
          data: {
            actorUserId: input.adminId,
            action: input.action,
            targetType: "Knowledge",
            targetId: input.knowledgeId,
            metadata: { ...input.auditMetadata, after: knowledge as unknown as object } as object,
          },
        });
        return {
          outcome: "ok" as const,
          knowledge,
          auditLogId: auditRow.id,
          versionFingerprint: counter.value.toString(),
        };
      });
    } catch (err) {
      if (err instanceof GovernanceConflictError) {
        const existing = await prisma.knowledge.findUnique({ where: { id: input.knowledgeId } });
        if (!existing) return { outcome: "not-found" };
        return { outcome: "wrong-status", knowledge: toKnowledgeRecord(existing) };
      }
      throw err;
    }
  }

  async publishNewVersion(input: PublishNewVersionStoreInput): Promise<PublishNewVersionStoreResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const updateResult = await tx.knowledge.updateMany({
          where: { id: input.fromKnowledgeId, lifecycleStatus: "active", deletedAt: null },
          data: {},
        });
        if (updateResult.count !== 1) {
          throw new GovernanceConflictError(input.fromKnowledgeId);
        }
        const prev = await tx.knowledge.findUniqueOrThrow({ where: { id: input.fromKnowledgeId } });
        const createdRow = await tx.knowledge.create({
          data: {
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
            provenance: input.newFields.provenance as unknown as object,
            confidence: input.newFields.confidence,
            lifecycleStatus: "active",
            version: prev.version + 1,
            supersedesId: prev.id,
            freshnessClass: input.newFields.freshnessClass,
            freshnessReviewEveryDays: input.newFields.freshnessReviewEveryDays,
            expiresAt: input.newFields.expiresAt,
            lastReviewedAt: now,
            approvedAt: now,
            approvedBy: input.adminId,
          },
        });
        const deprecatedRow = await tx.knowledge.update({
          where: { id: input.fromKnowledgeId },
          data: { supersededById: createdRow.id, lifecycleStatus: "deprecated", deprecatedAt: now },
        });
        const counter = await tx.knowledgeVersionCounter.upsert({
          where: { id: VERSION_COUNTER_ID },
          create: { id: VERSION_COUNTER_ID, value: BigInt(1) },
          update: { value: { increment: BigInt(1) } },
        });
        const created = toKnowledgeRecord(createdRow);
        const auditRow = await tx.auditLog.create({
          data: {
            actorUserId: input.adminId,
            action: "knowledge.new_version",
            targetType: "Knowledge",
            targetId: createdRow.id,
            metadata: {
              ...input.auditMetadata,
              previousVersionId: prev.id,
              version: created.version,
              after: created as unknown as object,
            } as object,
          },
        });
        return {
          outcome: "ok" as const,
          created,
          deprecated: toKnowledgeRecord(deprecatedRow),
          auditLogId: auditRow.id,
          versionFingerprint: counter.value.toString(),
        };
      });
    } catch (err) {
      if (err instanceof GovernanceConflictError) {
        const existing = await prisma.knowledge.findUnique({ where: { id: input.fromKnowledgeId } });
        if (!existing) return { outcome: "not-found" };
        // the row exists but isn't active — publishNewVersion only ever
        // fails "not-found" from the caller's point of view (K0.5 §2.3
        // asserts status=active as a precondition, not a distinct outcome);
        // report it as not-found rather than inventing a new outcome value.
        return { outcome: "not-found" };
      }
      throw err;
    }
  }
}
