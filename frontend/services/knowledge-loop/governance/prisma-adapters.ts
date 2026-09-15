// services/knowledge-loop/governance/prisma-adapters.ts
// Sprint K4.2-A — AT24 Knowledge Governance: production candidate store.
// Touches ONLY `prisma.knowledgeCandidate` — never `prisma.knowledge` or
// `prisma.knowledgeChunk` (K4.2A-D4, the governance boundary).

import { prisma } from "@/lib/prisma";
import type { CandidateRecord, KnowledgeProvenance } from "@/types/knowledge-loop";
import type { CandidateStorePort, CreateCandidateInput } from "./ports";

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
