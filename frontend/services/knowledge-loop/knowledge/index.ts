// services/knowledge-loop/knowledge/index.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: server-only barrel.
//
// INV-1 (K1_DECISION §3, governance-reach layer): this module — and the
// lifecycle transitions it re-exports — is NEVER imported by
// services/agent-framework/*, any tool handler, or the client bundle. A
// grep-level assertion in scripts/validate-knowledge-loop-schema.ts guards it.
//
// K1 exposes: KnowledgeService + its ports + the in-memory test backend +
// the Prisma production adapters + the K1-D ingestion seam.
// K2 adds: the Postgres-backed retrieval cache (ADR-K2-RETR-CACHE) + the
// freshness sweep. It does NOT export a candidate service, an orchestrator,
// an ANSWER cache, or analytics events — those are K3–K6.
//
// Server-only by convention (same as services/agent-framework/memory/index.ts):
// the Prisma adapters and `createKnowledgeService` are dynamically imported so
// a client bundle that tree-shakes them never pulls the DB client, and a
// validate script imports the leaf files (./knowledge-service, ./retrieval,
// ./in-memory-backend) directly rather than this barrel.

export { KnowledgeService } from "./knowledge-service";
export type { KnowledgeServiceDeps } from "./knowledge-service";
export type {
  KnowledgeStore,
  VectorSearchPort,
  VectorSearchQuery,
  VectorHit,
  EmbeddingPort,
  RetrievalCachePort,
  KnowledgeListFilter,
  TransitionInput,
  RetrievalLogEntry,
  CandidateSeedPort,
} from "./ports";
export {
  PrismaKnowledgeStore,
  PrismaVectorSearch,
  GeminiEmbeddingAdapter,
} from "./prisma-backend";
export {
  InMemoryKnowledgeBackend,
  FakeEmbedder,
} from "./in-memory-backend";
export type { SeedKnowledge } from "./in-memory-backend";
export {
  realIngestionPort,
  publishKnowledge,
  reindexKnowledge,
} from "./ingestion-adapter";
export type {
  IngestionPort,
  IngestOutcome,
  PublishResult,
} from "./ingestion-adapter";
// K2 — retrieval cache + freshness sweep
export {
  PrismaRetrievalCache,
  InMemoryRetrievalCache,
  normalizeCachedResults,
} from "./retrieval-cache";
export {
  runFreshnessSweep,
  FRESHNESS_SWEEP_ACTOR,
} from "./freshness-sweep";
export type { FreshnessSweepDeps } from "./freshness-sweep";
export {
  KNOWLEDGE_LOOP_CONFIG,
  RETRIEVAL_CONFIG_VERSION,
  AUTHORITY_WEIGHTS,
} from "@/config/knowledge-loop.config";

/**
 * Default production KnowledgeService — Prisma store + eligibility-filtered
 * VectorRepository + Gemini embeddings + (K2) the Postgres-backed retrieval
 * cache. Inert until the K1 + K2 migrations are applied. Lazily constructed so
 * importing the barrel does not open a DB connection.
 *
 * `withRetrievalCache` defaults to true; pass false to run the exact K1
 * (no-cache) retrieval path.
 */
export async function createKnowledgeService(
  opts: { withRetrievalCache?: boolean } = {},
) {
  const { KnowledgeService } = await import("./knowledge-service");
  const { PrismaKnowledgeStore, PrismaVectorSearch, GeminiEmbeddingAdapter } =
    await import("./prisma-backend");
  const { PrismaRetrievalCache } = await import("./retrieval-cache");
  return new KnowledgeService({
    store: new PrismaKnowledgeStore(),
    vectors: new PrismaVectorSearch(),
    embed: new GeminiEmbeddingAdapter(),
    retrievalCache:
      opts.withRetrievalCache === false
        ? undefined
        : new PrismaRetrievalCache(),
  });
}

/** K2-C — the freshness sweep bound to the production store. For a K6 cron. */
export async function createFreshnessSweep() {
  const { runFreshnessSweep } = await import("./freshness-sweep");
  const { PrismaKnowledgeStore } = await import("./prisma-backend");
  const store = new PrismaKnowledgeStore();
  return () => runFreshnessSweep({ store });
}

/** K2-A maintenance — purge expired retrieval-cache rows. For a K6 cron. */
export async function purgeRetrievalCache() {
  const { PrismaRetrievalCache } = await import("./retrieval-cache");
  const { KNOWLEDGE_LOOP_CONFIG } = await import(
    "@/config/knowledge-loop.config"
  );
  return new PrismaRetrievalCache().purgeExpired(
    KNOWLEDGE_LOOP_CONFIG.RETRIEVAL_CACHE_PURGE_GRACE_MS,
  );
}
