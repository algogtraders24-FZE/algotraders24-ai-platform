// services/knowledge-loop/governance/admin-queries.ts
// Sprint K4.2-C Phase 1 — read-only list/detail queries for the admin
// governance UI. Deliberately NOT an extension of CandidateStorePort/
// GovernanceStorePort (K4.2-A/B) — those are locked write-path ports;
// adding a list() capability to them would touch A/B's files for a concern
// that is purely this phase's own. This file queries
// prisma.knowledgeCandidate / prisma.knowledge directly, read-only, no
// mutation capability whatsoever (K4.2C-D2).

import { prisma } from "@/lib/prisma";
import type { CandidateRecord, KnowledgeProvenance, KnowledgeRecord } from "@/types/knowledge-loop";

export interface Page<T> {
  items: T[];
  total: number;
}

function toCandidateRecord(row: {
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
    proposedFreshnessClass: row.proposedFreshnessClass as CandidateRecord["proposedFreshnessClass"],
    sourceType: row.sourceType as CandidateRecord["sourceType"],
    status: row.status as CandidateRecord["status"],
    evidence: row.evidence as KnowledgeProvenance,
  };
}

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

export async function listCandidates(params: {
  page: number;
  pageSize: number;
  status?: string;
}): Promise<Page<CandidateRecord>> {
  const where = {
    deletedAt: null,
    ...(params.status ? { status: params.status as never } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.knowledgeCandidate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.knowledgeCandidate.count({ where }),
  ]);
  return { items: rows.map(toCandidateRecord), total };
}

export async function getCandidateDetail(id: string): Promise<CandidateRecord | null> {
  const row = await prisma.knowledgeCandidate.findUnique({ where: { id } });
  return row && row.deletedAt === null ? toCandidateRecord(row) : null;
}

export async function listKnowledge(params: {
  page: number;
  pageSize: number;
  lifecycleStatus?: string;
}): Promise<Page<KnowledgeRecord>> {
  const where = {
    deletedAt: null,
    lifecycleStatus: params.lifecycleStatus ? (params.lifecycleStatus as never) : { not: null },
  };
  const [rows, total] = await Promise.all([
    prisma.knowledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.knowledge.count({ where }),
  ]);
  return { items: rows.map(toKnowledgeRecord), total };
}
