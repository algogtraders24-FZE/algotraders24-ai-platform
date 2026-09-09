// services/knowledge-loop/knowledge/knowledge-service.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: the canonical application
// boundary for Knowledge operations (K1_DECISION §4 K1-C).
// Sprint K2 — + Postgres-backed retrieval cache (ADR-K2-RETR-CACHE) +
// canonical retrieval logging (§8) wired into retrieve().
//
// SCOPE: create(draft) · getById · list · retrieve · lifecycle transitions
// (markActive / deprecate / archive / reinstate / newVersion). The Governance
// wrapper (AuditLog + admin routes + explicit human approval) is K4; the
// ANSWER cache is K5 — untouched here.
//
// INV-1 (K1_DECISION §3): `retrieve` reads Knowledge/KnowledgeChunk ONLY. It
// never imports, queries, or is wired to `KnowledgeCandidate`. It re-checks
// eligibility after hydration on BOTH the fresh and the cache-hit path, so a
// cache hit can never resurrect a row that has since become ineligible.
//
// Server-only. NEVER imported by services/agent-framework/* or any tool
// handler (INV-1 governance-reach layer).

import {
  KNOWLEDGE_LOOP_CONFIG,
} from "@/config/knowledge-loop.config";
import type {
  KnowledgeRecord,
  RetrievalOptions,
  RetrievalResult,
  RetrievalHit,
  CreateKnowledgeInput,
  TransitionResult,
  NewVersionResult,
  CachedRetrievalEntry,
} from "@/types/knowledge-loop";
import type {
  KnowledgeStore,
  VectorSearchPort,
  VectorHit,
  EmbeddingPort,
  RetrievalCachePort,
  KnowledgeListFilter,
} from "./ports";
import {
  normalizeQuery,
  queryHash,
  retrievalCacheKey,
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

// KNOWLEDGE_RETRIEVAL_CONTRACT §7.6 — the caller signature folded into the
// cache key. Captures visibility (role) AND user isolation (userId, only when
// scope=user rows are in play).
function callerScopeSig(opts: RetrievalOptions, includeUserScope: boolean): string {
  return `${opts.callerRole}:${includeUserScope ? opts.callerUserId : ""}`;
}

export interface KnowledgeServiceDeps {
  store: KnowledgeStore;
  vectors: VectorSearchPort;
  embed: EmbeddingPort;
  /** K2 — optional. When omitted, retrieve() behaves byte-identically to K1. */
  retrievalCache?: RetrievalCachePort;
  clock?: () => Date;
}

interface PipelineOutput {
  result: RetrievalResult;
  /** the eligible, threshold-passing hits — what the cache stores on a miss. */
  cacheable: CachedRetrievalEntry[] | null;
}

export class KnowledgeService {
  private readonly store: KnowledgeStore;
  private readonly vectors: VectorSearchPort;
  private readonly embed: EmbeddingPort;
  private readonly retrievalCache?: RetrievalCachePort;
  private readonly clock: () => Date;

  constructor(deps: KnowledgeServiceDeps) {
    this.store = deps.store;
    this.vectors = deps.vectors;
    this.embed = deps.embed;
    this.retrievalCache = deps.retrievalCache;
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

  // ── retrieval (KNOWLEDGE_RETRIEVAL_CONTRACT.md §3.1 + §7.2) ─────────
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
      return r; // never cached
    }
    const qh = queryHash(norm.normalized);

    const topK = opts.topK ?? C.RETRIEVE_TOP_K;
    const includeUserScope = opts.includeUserScope !== false;
    const scopes = [...opts.scopes];
    const visibilities = visibilitiesForRole(opts.callerRole);
    const scopeSig = callerScopeSig(opts, includeUserScope);

    // 2. retrieval cache (K2) — read BEFORE embed. The key folds in the
    // knowledge-version fingerprint, so any lifecycle transition since the
    // entry was written makes the key miss (lazy invalidation, §7.4).
    const fingerprint = await this.store.getVersionFingerprint();
    const cacheKey = retrievalCacheKey(
      norm.lower,
      scopes,
      scopeSig,
      topK,
      fingerprint,
    );

    if (this.retrievalCache) {
      const cached = await this.retrievalCache.get(cacheKey).catch(() => null);
      if (cached) {
        const hit = await this.fromCacheEntries(
          cached.results,
          opts,
          now,
          qh,
          startedAt,
        );
        if (hit) return hit; // a hit that survived live re-filtering
        // else: every cached row is now ineligible → fall through to a
        // fresh retrieval (never serve a stale/empty hit as authoritative).
      }
    }

    // 3. embed
    let embedding: number[];
    try {
      embedding = await this.embed.embed(norm.normalized);
    } catch {
      const r = this.empty("embedding-failed", startedAt);
      await this.log(qh, opts, r, 0);
      return r; // never cached
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

    const { result, cacheable } = this.pipeline(
      vhits,
      recById,
      opts,
      now,
      qh,
      startedAt,
      false,
    );
    await this.log(qh, opts, result, result.hits.length);

    // 8. retrieval-cache write — only after a real search, and only for a
    // terminal result (never on a transient embedding failure / empty query).
    if (
      this.retrievalCache &&
      cacheable !== null &&
      ["ok", "below-threshold", "no-eligible-rows"].includes(result.reason)
    ) {
      await this.retrievalCache
        .set(
          cacheKey,
          { results: cacheable },
          { queryHash: qh, scopeSig, versionFingerprint: fingerprint },
          C.RETRIEVAL_CACHE_TTL_MS,
        )
        .catch(() => {});
    }

    return result;
  }

  /**
   * Cache-HIT path. Re-hydrate the cached chunk ids to LIVE `Knowledge` +
   * `KnowledgeChunk` rows, then run the exact same eligibility filter +
   * ranking as a fresh retrieval. Returns null if nothing survives (caller
   * then does a fresh retrieval — a stale cache never yields an authoritative
   * empty result).
   */
  private async fromCacheEntries(
    entries: CachedRetrievalEntry[],
    opts: RetrievalOptions,
    now: Date,
    qh: string,
    startedAt: number,
  ): Promise<RetrievalResult | null> {
    if (entries.length === 0) {
      // a cached genuine miss — re-serve it as a miss (still cheaper: no embed).
      const r = this.empty("no-eligible-rows", startedAt);
      r.fromCache = true;
      await this.log(qh, opts, r, 0);
      return r;
    }
    const knowledgeIds = [...new Set(entries.map((e) => e.knowledgeId))];
    const [recs, chunks] = await Promise.all([
      this.store.getByIds(knowledgeIds),
      this.store.getChunks(knowledgeIds),
    ]);
    const recById = new Map(recs.map((r) => [r.id, r]));
    const chunkById = new Map(chunks.map((c) => [c.chunkId, c]));

    // rebuild VectorHit[] from cached similarity + LIVE chunk content. A chunk
    // that was deleted / re-ingested away is simply dropped.
    const vhits: VectorHit[] = [];
    for (const e of entries) {
      const chunk = chunkById.get(e.chunkId);
      if (!chunk) continue;
      vhits.push({
        chunkId: e.chunkId,
        knowledgeId: e.knowledgeId,
        userId: chunk.userId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        similarity: e.similarity,
      });
    }
    if (vhits.length === 0) return null; // all cached chunks gone → fresh retrieval

    const { result } = this.pipeline(vhits, recById, opts, now, qh, startedAt, true);
    if (result.hits.length === 0 && result.reason !== "below-threshold") {
      // every cached row became ineligible → don't serve; caller goes fresh.
      return null;
    }
    await this.log(qh, opts, result, result.hits.length);
    return result;
  }

  // ── the deterministic pipeline (shared by fresh + cache-hit paths) ──
  // re-filter eligibility → threshold → score → rank → context → sufficiency
  private pipeline(
    vhits: VectorHit[],
    recById: Map<string, KnowledgeRecord>,
    opts: RetrievalOptions,
    now: Date,
    _qh: string,
    startedAt: number,
    fromCache: boolean,
  ): PipelineOutput {
    const includeUserScope = opts.includeUserScope !== false;
    const allowedScopes = new Set<string>(opts.scopes);
    const allowedVis = new Set(visibilitiesForRole(opts.callerRole));

    // 4b. RE-FILTER eligibility on hydration (INV-1 — this is the layer the
    // tests pin to; the SQL gate does it too on the fresh path).
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

    // what the cache stores: the eligible, threshold-passing hits (chunk ids +
    // similarity only). On a MISS this is written; on a HIT it is not.
    const cacheable: CachedRetrievalEntry[] = aboveMin.map((h) => ({
      chunkId: h.chunkId,
      knowledgeId: h.knowledgeId,
      chunkIndex: h.chunkIndex,
      similarity: h.similarity,
    }));

    if (aboveMin.length === 0) {
      return {
        result: {
          hits: [],
          contextBlock: "",
          sufficiency: "INSUFFICIENT",
          bestSimilarity,
          fromCache,
          latencyMs: Date.now() - startedAt,
          reason: eligible.length > 0 ? "below-threshold" : "no-eligible-rows",
        },
        cacheable,
      };
    }

    const scored = aboveMin.map((h) =>
      scoreHit(h, recById.get(h.knowledgeId)!, now),
    );
    const ranked = rankAndDedup(scored, recById);
    const { contextBlock, kept } = selectContext(ranked);
    const hits: RetrievalHit[] = kept;
    const sufficiency = computeSufficiency(kept, true);

    return {
      result: {
        hits,
        contextBlock,
        sufficiency,
        bestSimilarity: hits[0]?.similarity ?? bestSimilarity,
        fromCache,
        latencyMs: Date.now() - startedAt,
        reason: "ok",
      },
      cacheable,
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

  // K2-B: canonical KnowledgeRetrievalLog emit — every terminal retrieval,
  // cache hit or miss. `fromCache` distinguishes hit / miss; `hitCount` is the
  // result count; `sufficiency` + `bestSimilarity` + `latencyMs` per §8. Raw
  // query text is NEVER logged — only `queryHash`.
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
