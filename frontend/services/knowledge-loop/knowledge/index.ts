// services/knowledge-loop/knowledge/index.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: server-only barrel.
//
// INV-1 (K1_DECISION §3, governance-reach layer): this module — and the
// lifecycle transitions it re-exports — is NEVER imported by
// services/agent-framework/*, any tool handler, or the client bundle. A
// grep-level assertion in scripts/validate-knowledge-loop-schema.ts guards it.
//
// K1 exposes: KnowledgeService + its ports + the in-memory test backend +
// the Prisma production adapters + the K1-D ingestion seam. It does NOT
// export a candidate service, an orchestrator, a cache, or analytics events —
// those are K2–K6.
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
// K1-D adds the ingestion seam here (publishKnowledge / realIngestionPort).
export {
  KNOWLEDGE_LOOP_CONFIG,
  AUTHORITY_WEIGHTS,
} from "@/config/knowledge-loop.config";

/**
 * Default production KnowledgeService — Prisma store + eligibility-filtered
 * VectorRepository + Gemini embeddings. Inert until the K1 migration is
 * applied (K1-F). Lazily constructed so importing the barrel does not open a
 * DB connection.
 */
export async function createKnowledgeService() {
  const { KnowledgeService } = await import("./knowledge-service");
  const { PrismaKnowledgeStore, PrismaVectorSearch, GeminiEmbeddingAdapter } =
    await import("./prisma-backend");
  return new KnowledgeService({
    store: new PrismaKnowledgeStore(),
    vectors: new PrismaVectorSearch(),
    embed: new GeminiEmbeddingAdapter(),
  });
}
