// services/knowledge-loop/knowledge/retrieval-cache.ts
// Sprint K2 — AT24 AI Assistant Knowledge Loop: retrieval-cache adapters.
//
// Contract: KNOWLEDGE_RETRIEVAL_CONTRACT.md §7.2 (ADR-K2-RETR-CACHE) / §7.5 / §7.6.
//
//   PrismaRetrievalCache   — the real `KnowledgeRetrievalCache` Postgres table.
//                            Inert until the K2 migration is applied.
//   InMemoryRetrievalCache — deterministic, offline; for `validate:knowledge-loop-*`.
//
// This is the RETRIEVAL cache, not the ANSWER cache. It never stores answer
// text, never a Knowledge snapshot — only chunk ids + similarity. The
// KnowledgeService re-hydrates + re-filters + re-ranks live on every hit, so a
// stale entry can never resurrect an ineligible row (INV-1). No Redis / KV.

import type { CachedRetrieval, CachedRetrievalEntry } from "@/types/knowledge-loop";
import type { RetrievalCachePort } from "./ports";

function sanitize(value: unknown): CachedRetrieval {
  const arr = Array.isArray((value as { results?: unknown })?.results)
    ? (value as { results: unknown[] }).results
    : [];
  const results: CachedRetrievalEntry[] = [];
  for (const r of arr) {
    if (
      r &&
      typeof (r as CachedRetrievalEntry).chunkId === "string" &&
      typeof (r as CachedRetrievalEntry).knowledgeId === "string" &&
      typeof (r as CachedRetrievalEntry).similarity === "number"
    ) {
      const e = r as CachedRetrievalEntry;
      results.push({
        chunkId: e.chunkId,
        knowledgeId: e.knowledgeId,
        chunkIndex: typeof e.chunkIndex === "number" ? e.chunkIndex : 0,
        similarity: e.similarity,
      });
    }
  }
  return { results };
}

/** Real `KnowledgeRetrievalCache` table. Server-only; inert pre-migration. */
export class PrismaRetrievalCache implements RetrievalCachePort {
  async get(key: string): Promise<CachedRetrieval | null> {
    const { prisma } = await import("@/lib/prisma");
    try {
      const row = await prisma.knowledgeRetrievalCache.findFirst({
        where: { key, expiresAt: { gt: new Date() } },
        select: { results: true },
      });
      return row ? sanitize(row.results) : null;
    } catch {
      // A cache read must never break retrieval — treat any failure as a miss.
      return null;
    }
  }

  async set(
    key: string,
    value: CachedRetrieval,
    meta: { queryHash: string; scopeSig: string; versionFingerprint: string },
    ttlMs: number,
  ): Promise<void> {
    const { prisma } = await import("@/lib/prisma");
    const expiresAt = new Date(Date.now() + ttlMs);
    const results = sanitize(value).results;
    const data = {
      queryHash: meta.queryHash,
      scopeSig: meta.scopeSig,
      knowledgeVersionFingerprint: meta.versionFingerprint,
      results: results as unknown as object,
      resultCount: results.length,
      expiresAt,
    };
    try {
      await prisma.knowledgeRetrievalCache.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
    } catch {
      // best-effort — a failed cache write never breaks retrieval.
    }
  }

  async purgeExpired(graceMs: number): Promise<number> {
    const { prisma } = await import("@/lib/prisma");
    try {
      const cutoff = new Date(Date.now() - graceMs);
      const r = await prisma.knowledgeRetrievalCache.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      return r.count;
    } catch {
      return 0;
    }
  }
}

interface MemEntry {
  value: CachedRetrieval;
  expiresAt: number;
  meta: { queryHash: string; scopeSig: string; versionFingerprint: string };
}

/** Deterministic offline retrieval cache for tests (injectable clock). */
export class InMemoryRetrievalCache implements RetrievalCachePort {
  private readonly store = new Map<string, MemEntry>();
  /** test visibility */
  reads = 0;
  writes = 0;
  hits = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async get(key: string): Promise<CachedRetrieval | null> {
    this.reads += 1;
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt <= this.clock().getTime()) {
      this.store.delete(key);
      return null;
    }
    this.hits += 1;
    // return a copy so a caller mutation can't corrupt the cached entry
    return { results: e.value.results.map((r) => ({ ...r })) };
  }

  async set(
    key: string,
    value: CachedRetrieval,
    meta: { queryHash: string; scopeSig: string; versionFingerprint: string },
    ttlMs: number,
  ): Promise<void> {
    this.writes += 1;
    this.store.set(key, {
      value: { results: sanitize(value).results },
      expiresAt: this.clock().getTime() + ttlMs,
      meta,
    });
  }

  async purgeExpired(graceMs: number): Promise<number> {
    const cutoff = this.clock().getTime() - graceMs;
    let removed = 0;
    for (const [k, e] of this.store) {
      if (e.expiresAt < cutoff) {
        this.store.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  /** test helper — total live entries. */
  size(): number {
    return this.store.size;
  }
  /** test helper — raw entry (bypasses TTL) for asserting key contents. */
  peek(key: string): MemEntry | undefined {
    return this.store.get(key);
  }
}
