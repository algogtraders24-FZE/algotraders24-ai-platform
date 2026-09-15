// services/knowledge-loop/governance/in-memory-adapters.ts
// Sprint K4.2-A — AT24 Knowledge Governance: offline test doubles.
// `validate-k4.2a-candidate-capture.ts` runs entirely against these — no DB,
// no embedding API, no network (K1/K2/K3 precedent).

import type { CandidateRecord } from "@/types/knowledge-loop";
import type {
  CandidateStorePort,
  CreateCandidateInput,
  EmbeddingPort,
  VectorHit,
  VectorSearchPort,
  VectorSearchQuery,
} from "./ports";

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
