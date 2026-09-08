// services/knowledge-loop/knowledge/in-memory-backend.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. Process-local, deterministic
// adapters for `validate:knowledge-loop-*` (AN1.9 InMemoryStore precedent).
// Never used in production. Replays the same eligibility predicate the
// production SQL enforces (VectorRepository K1 branch), so an offline test
// proves the same INV-1 guarantee.

import { randomUUID } from "node:crypto";
import type {
  KnowledgeRecord,
  KnowledgeChunkRecord,
  CreateKnowledgeInput,
} from "@/types/knowledge-loop";
import type {
  KnowledgeStore,
  KnowledgeListFilter,
  TransitionInput,
  RetrievalLogEntry,
  VectorSearchPort,
  VectorSearchQuery,
  VectorHit,
  EmbeddingPort,
  CandidateSeedPort,
} from "./ports";

interface StoredChunk extends KnowledgeChunkRecord {
  embedding: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SeedKnowledge extends CreateKnowledgeInput {
  id?: string;
  lifecycleStatus?: KnowledgeRecord["lifecycleStatus"];
  supersededById?: string | null;
  supersedesId?: string | null;
  approvedAt?: Date | null;
  lastReviewedAt?: Date | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  version?: number;
  /** chunk texts — each embedded via the provided fake embedder. */
  chunks: string[];
}

export class InMemoryKnowledgeBackend
  implements KnowledgeStore, VectorSearchPort, CandidateSeedPort
{
  private readonly knowledge = new Map<string, KnowledgeRecord>();
  private readonly chunks: StoredChunk[] = [];
  private readonly candidates = new Map<
    string,
    { canonicalQuestion: string; proposedAnswer: string; status: string }
  >();
  private counter = 0;
  readonly retrievalLogs: RetrievalLogEntry[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  // ── test seeding ────────────────────────────────────────────────────
  async seed(input: SeedKnowledge, embed: EmbeddingPort): Promise<KnowledgeRecord> {
    const id = input.id ?? `k_${randomUUID()}`;
    const now = input.createdAt ?? this.clock();
    const rec: KnowledgeRecord = {
      id,
      userId: input.userId,
      title: input.title,
      description: input.description ?? "",
      category: input.category ?? "general",
      canonicalQuestion: input.canonicalQuestion ?? null,
      canonicalAnswer: input.canonicalAnswer ?? null,
      knowledgeType: input.knowledgeType,
      scope: input.scope,
      visibility: input.visibility ?? "customer",
      source: input.source,
      sourceType: input.sourceType,
      provenance: input.provenance,
      confidence: input.confidence ?? null,
      status: "processing",
      lifecycleStatus:
        input.lifecycleStatus ?? (input.scope === "user" ? null : "draft"),
      embeddingStatus: "embedded",
      version: input.version ?? 1,
      supersedesId: input.supersedesId ?? null,
      supersededById: input.supersededById ?? null,
      freshnessClass: input.freshnessClass,
      freshnessReviewEveryDays: input.freshnessReviewEveryDays ?? null,
      expiresAt: input.expiresAt ?? null,
      lastReviewedAt: input.lastReviewedAt ?? null,
      approvedAt: input.approvedAt ?? null,
      approvedBy: null,
      deprecatedAt: null,
      deprecatedBy: null,
      retrievalCount: 0,
      lastRetrievedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: input.deletedAt ?? null,
    };
    this.knowledge.set(id, rec);
    let idx = 0;
    for (const text of input.chunks) {
      const embedding = await embed.embed(text);
      this.chunks.push({
        chunkId: `c_${randomUUID()}`,
        knowledgeId: id,
        userId: input.userId,
        chunkIndex: idx,
        content: text,
        embedding,
      });
      idx += 1;
    }
    return rec;
  }

  // ── CandidateSeedPort (INV-1 proof only) ────────────────────────────
  async seedCandidate(input: {
    id: string;
    canonicalQuestion: string;
    proposedAnswer: string;
    status: string;
  }): Promise<void> {
    this.candidates.set(input.id, {
      canonicalQuestion: input.canonicalQuestion,
      proposedAnswer: input.proposedAnswer,
      status: input.status,
    });
  }
  async listCandidateIds(): Promise<string[]> {
    return [...this.candidates.keys()];
  }

  // ── KnowledgeStore ─────────────────────────────────────────────────
  async getById(id: string): Promise<KnowledgeRecord | null> {
    return this.knowledge.get(id) ?? null;
  }
  async getByIds(ids: string[]): Promise<KnowledgeRecord[]> {
    return ids.map((id) => this.knowledge.get(id)).filter((r): r is KnowledgeRecord => !!r);
  }
  async getChunks(knowledgeIds: string[]): Promise<KnowledgeChunkRecord[]> {
    const set = new Set(knowledgeIds);
    return this.chunks
      .filter((c) => set.has(c.knowledgeId))
      .map((c) => ({
        chunkId: c.chunkId,
        knowledgeId: c.knowledgeId,
        userId: c.userId,
        chunkIndex: c.chunkIndex,
        content: c.content,
      }));
  }
  async list(filter: KnowledgeListFilter): Promise<KnowledgeRecord[]> {
    return [...this.knowledge.values()].filter((r) => {
      if (!filter.includeDeleted && r.deletedAt) return false;
      if (filter.scope && r.scope !== filter.scope) return false;
      if (filter.lifecycleStatus && r.lifecycleStatus !== filter.lifecycleStatus)
        return false;
      if (filter.knowledgeType && r.knowledgeType !== filter.knowledgeType)
        return false;
      if (filter.supersededOnly && !r.supersededById) return false;
      return true;
    });
  }

  async create(input: CreateKnowledgeInput): Promise<KnowledgeRecord> {
    return this.seed({ ...input, chunks: [] }, { embed: async () => [] });
  }

  private bump(): string {
    this.counter += 1;
    return this.counter.toString();
  }

  async transition(
    input: TransitionInput,
  ): Promise<{ knowledge: KnowledgeRecord; versionFingerprint: string }> {
    const rec = this.knowledge.get(input.id);
    if (!rec) throw new Error(`knowledge ${input.id} not found`);
    const now = this.clock();
    rec.lifecycleStatus = input.to;
    rec.updatedAt = now;
    if (input.patch) Object.assign(rec, input.patch);
    if (input.to === "active" && !rec.approvedAt) {
      rec.approvedAt = now;
      rec.approvedBy = input.actorId;
    }
    if (input.to === "deprecated") {
      rec.deprecatedAt = now;
      rec.deprecatedBy = input.actorId;
    }
    return { knowledge: rec, versionFingerprint: this.bump() };
  }

  async createVersionOf(
    fromId: string,
    input: CreateKnowledgeInput,
  ): Promise<{
    created: KnowledgeRecord;
    deprecated: KnowledgeRecord;
    versionFingerprint: string;
  }> {
    const prev = this.knowledge.get(fromId);
    if (!prev) throw new Error(`knowledge ${fromId} not found`);
    const now = this.clock();
    const created = await this.seed(
      {
        ...input,
        supersedesId: prev.id,
        version: prev.version + 1,
        lifecycleStatus: "active",
        approvedAt: now,
        chunks: [],
      },
      { embed: async () => [] },
    );
    prev.supersededById = created.id;
    prev.lifecycleStatus = "deprecated";
    prev.deprecatedAt = now;
    prev.updatedAt = now;
    return { created, deprecated: prev, versionFingerprint: this.bump() };
  }

  async getVersionFingerprint(): Promise<string> {
    return this.counter.toString();
  }

  async recordRetrieval(
    knowledgeIds: string[],
    log: RetrievalLogEntry,
  ): Promise<void> {
    const now = this.clock();
    for (const id of knowledgeIds) {
      const rec = this.knowledge.get(id);
      if (rec) {
        rec.retrievalCount += 1;
        rec.lastRetrievedAt = now;
      }
    }
    this.retrievalLogs.push(log);
  }

  // ── VectorSearchPort — replays the production SQL predicate in JS ────
  async searchSimilar(q: VectorSearchQuery): Promise<VectorHit[]> {
    const now = this.clock();
    const scopeSet = new Set(q.scopes);
    const visSet = new Set(q.visibilities);
    const scored: Array<VectorHit & { dist: number }> = [];
    for (const chunk of this.chunks) {
      const rec = this.knowledge.get(chunk.knowledgeId);
      if (!rec) continue;
      if (q.knowledgeId && rec.id !== q.knowledgeId) continue;

      // Same two-branch eligibility the K1 VectorRepository SQL enforces.
      const verifiedBranch =
        scopeSet.has(rec.scope) &&
        rec.lifecycleStatus === "active" &&
        (visSet.size === 0 || visSet.has(rec.visibility)) &&
        !rec.supersededById &&
        !rec.deletedAt &&
        (!rec.expiresAt || rec.expiresAt.getTime() > now.getTime());
      const ownBranch =
        q.includeUserScope &&
        rec.scope === "user" &&
        rec.userId === q.callerUserId &&
        (rec.lifecycleStatus === null || rec.lifecycleStatus === "active") &&
        !rec.supersededById &&
        !rec.deletedAt &&
        (!rec.expiresAt || rec.expiresAt.getTime() > now.getTime());
      if (!verifiedBranch && !ownBranch) continue;

      const sim = cosine(q.embedding, chunk.embedding);
      scored.push({
        chunkId: chunk.chunkId,
        knowledgeId: chunk.knowledgeId,
        userId: chunk.userId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        similarity: sim,
        dist: 1 - sim,
      });
    }
    scored.sort((a, b) => a.dist - b.dist);
    return scored.slice(0, q.topK).map((s) => ({
      chunkId: s.chunkId,
      knowledgeId: s.knowledgeId,
      userId: s.userId,
      content: s.content,
      chunkIndex: s.chunkIndex,
      similarity: s.similarity,
    }));
  }
}

/**
 * Deterministic fake embedder for tests — a bag-of-words hashing embedder that
 * gives similar text similar 768-d vectors, WITHOUT calling Gemini. Not used
 * in production (that path uses GeminiEmbeddingProvider via the prisma adapter).
 */
export class FakeEmbedder implements EmbeddingPort {
  constructor(private readonly dims = 768) {}
  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dims).fill(0);
    for (const tokenRaw of text.toLowerCase().split(/[^a-z0-9]+/)) {
      const token = tokenRaw.trim();
      if (!token) continue;
      let h = 2166136261;
      for (let i = 0; i < token.length; i += 1) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dims;
      v[idx] += 1;
    }
    let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm === 0) norm = 1;
    return v.map((x) => x / norm);
  }
}
