// services/knowledge-loop/knowledge/knowledge-service.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: the canonical application
// boundary for Knowledge operations (K1_DECISION §4 K1-C).
//
// SCOPE (K1): create(draft) · getById · list · retrieve · lifecycle transition
// helpers (markActive / deprecate / archive / reinstate / newVersion). The
// Governance wrapper (AuditLog + admin routes + explicit human approval) is
// K4; the retrieval cache + answer cache are K5 — this service exposes the
// transitions the governance layer will call and the eligibility-filtered
// retrieval pipeline, nothing more.
//
// INV-1 (K1_DECISION §3): `retrieve` reads Knowledge/KnowledgeChunk ONLY (via
// the VectorSearchPort + KnowledgeStore). It never imports, queries, or is
// wired to `KnowledgeCandidate`. It also RE-CHECKS eligibility after
// hydration, so the SQL gate and the service agree.
//
// Server-only. NEVER imported by services/agent-framework/* or any tool
// handler (INV-1 governance-reach layer).

import { KNOWLEDGE_LOOP_CONFIG } from "@/config/knowledge-loop.config";
import type {
  KnowledgeRecord,
  RetrievalOptions,
  RetrievalResult,
  RetrievalHit,
  CreateKnowledgeInput,
  TransitionResult,
  NewVersionResult,
} from "@/types/knowledge-loop";
import type {
  KnowledgeStore,
  VectorSearchPort,
  VectorHit,
  EmbeddingPort,
  KnowledgeListFilter,
} from "./ports";
import {
  normalizeQuery,
  queryHash,
  isEligible,
  scoreHit,
  rankAndDedup,
  selectContext,
  computeSufficiency,
} from "./retrieval";

const C = KNOWLEDGE_LOOP_CONFIG;

// Visibility a caller role may retrieve (KNOWLEDGE_GOVERNANCE_CONTRACT §7.1).
function visibilitiesForRole(role: string): string[] {
  if (role === "admin") return ["public", "customer", "admin"];
  if (role === "guest" || role === "anon") return ["public"];
  return ["public", "customer"]; // authenticated non-admin
}

export interface KnowledgeServiceDeps {
  store: KnowledgeStore;
  vectors: VectorSearchPort;
  embed: EmbeddingPort;
  clock?: () => Date;
}

export class KnowledgeService {
  private readonly store: KnowledgeStore;
  private readonly vectors: VectorSearchPort;
  private readonly embed: EmbeddingPort;
  private readonly clock: () => Date;

  constructor(deps: KnowledgeServiceDeps) {
    this.store = deps.store;
    this.vectors = deps.vectors;
    this.embed = deps.embed;
    this.clock = deps.clock ?? (() => new Date());
  }

  // ── plain reads / create ───────────────────────────────────────────
  getById(id: string): Promise<KnowledgeRecord | null> {
    return this.store.getById(id);
  }
  list(filter: KnowledgeListFilter = {}): Promise<KnowledgeRecord[]> {
    return this.store.list(filter);
  }
  /** Creates a `draft` row. NOT retrievable until markActive() + ingestion. */
  create(input: CreateKnowledgeInput): Promise<KnowledgeRecord> {
    return this.store.create(input);
  }

  // ── lifecycle transitions (Governance calls these in K4) ────────────
  markActive(
    id: string,
    actorId: string,
    confidence?: number,
  ): Promise<TransitionResult> {
    return this.store.transition({
      id,
      to: "active",
      actorId,
      patch: confidence !== undefined ? { confidence } : undefined,
    });
  }
  deprecate(
    id: string,
    actorId: string,
    reason?: string,
  ): Promise<TransitionResult> {
    return this.store.transition({ id, to: "deprecated", actorId, reason });
  }
  archive(id: string, actorId: string): Promise<TransitionResult> {
    return this.store.transition({ id, to: "archived", actorId });
  }
  reinstate(id: string, actorId: string): Promise<TransitionResult> {
    return this.store.transition({ id, to: "active", actorId });
  }
  newVersion(
    fromId: string,
    input: CreateKnowledgeInput,
  ): Promise<NewVersionResult> {
    return this.store.createVersionOf(fromId, input);
  }

  // ── retrieval (KNOWLEDGE_RETRIEVAL_CONTRACT.md §3.1) ────────────────
  async retrieve(
    query: string,
    opts: RetrievalOptions,
  ): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const now = this.clock();

    const norm = normalizeQuery(query);
    if (!norm) {
      const r = this.empty("empty-query", startedAt);
      await this.log(queryHash(""), opts, r, 0);
      return r;
    }
    const qh = queryHash(norm.normalized);

    const topK = opts.topK ?? C.RETRIEVE_TOP_K;
    const includeUserScope = opts.includeUserScope !== false;
    const scopes = [...opts.scopes];
    const visibilities = visibilitiesForRole(opts.callerRole);

    // 3. embed
    let embedding: number[];
    try {
      embedding = await this.embed.embed(norm.normalized);
    } catch {
      const r = this.empty("embedding-failed", startedAt);
      await this.log(qh, opts, r, 0);
      return r;
    }

    // 4. eligibility-filtered vector search (SQL gate — INV-1 structural layer)
    const vhits = await this.vectors.searchSimilar({
      embedding,
      topK,
      scopes,
      visibilities,
      includeUserScope,
      callerUserId: opts.callerUserId,
      knowledgeId: opts.knowledgeId,
    });

    const knowledgeIds = [...new Set(vhits.map((h) => h.knowledgeId))];
    const recs = await this.store.getByIds(knowledgeIds);
    const recById = new Map(recs.map((r) => [r.id, r]));

    return this.rank(vhits, recById, opts, now, qh, startedAt);
  }

  // re-filter → threshold → score → rank → context → log
  private async rank(
    vhits: VectorHit[],
    recById: Map<string, KnowledgeRecord>,
    opts: RetrievalOptions,
    now: Date,
    qh: string,
    startedAt: number,
  ): Promise<RetrievalResult> {
    const includeUserScope = opts.includeUserScope !== false;
    const allowedScopes = new Set<string>(opts.scopes);
    const allowedVis = new Set(visibilitiesForRole(opts.callerRole));

    // 4b. RE-FILTER eligibility on hydration (defense in depth; the SQL gate
    // already did this, but the service is the layer the INV-1 tests pin to).
    const eligible = vhits.filter((h) => {
      const rec = recById.get(h.knowledgeId);
      if (!rec) return false;
      if (!isEligible(rec, now)) return false;
      if (rec.scope === "user") {
        return includeUserScope && rec.userId === opts.callerUserId;
      }
      return allowedScopes.has(rec.scope) && allowedVis.has(rec.visibility);
    });

    const bestSimilarity = eligible.reduce(
      (m, h) => Math.max(m, h.similarity),
      0,
    );
    const aboveMin = eligible.filter((h) => h.similarity >= C.RELEVANCE_MIN);

    if (aboveMin.length === 0) {
      const r: RetrievalResult = {
        hits: [],
        contextBlock: "",
        sufficiency: "INSUFFICIENT",
        bestSimilarity,
        fromCache: false,
        latencyMs: Date.now() - startedAt,
        reason: eligible.length > 0 ? "below-threshold" : "no-eligible-rows",
      };
      await this.log(qh, opts, r, 0);
      return r;
    }

    const scored = aboveMin.map((h) =>
      scoreHit(h, recById.get(h.knowledgeId)!, now),
    );
    const ranked = rankAndDedup(scored, recById);
    const { contextBlock, kept } = selectContext(ranked);
    const hits: RetrievalHit[] = kept;
    const sufficiency = computeSufficiency(kept, true);
    const latencyMs = Date.now() - startedAt;

    await this.log(qh, opts, {
      hits,
      contextBlock,
      sufficiency,
      bestSimilarity: hits[0]?.similarity ?? bestSimilarity,
      fromCache: false,
      latencyMs,
      reason: "ok",
    }, hits.length);

    return {
      hits,
      contextBlock,
      sufficiency,
      bestSimilarity: hits[0]?.similarity ?? bestSimilarity,
      fromCache: false,
      latencyMs,
      reason: "ok",
    };
  }

  private empty(reason: string, startedAt: number): RetrievalResult {
    return {
      hits: [],
      contextBlock: "",
      sufficiency: "INSUFFICIENT",
      bestSimilarity: 0,
      fromCache: false,
      latencyMs: Date.now() - startedAt,
      reason,
    };
  }

  private async log(
    qh: string,
    opts: RetrievalOptions,
    r: RetrievalResult,
    hitCount: number,
  ): Promise<void> {
    const keptKnowledgeIds = [...new Set(r.hits.map((h) => h.knowledgeId))];
    await this.store
      .recordRetrieval(keptKnowledgeIds, {
        userId: opts.callerUserId,
        conversationId: opts.conversationId ?? null,
        queryHash: qh,
        scopes: opts.scopes,
        hitCount,
        bestSimilarity: r.bestSimilarity || null,
        sufficiency: r.sufficiency,
        fromCache: r.fromCache,
        latencyMs: r.latencyMs,
      })
      .catch(() => {});
  }
}
