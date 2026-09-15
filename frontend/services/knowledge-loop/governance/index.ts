// services/knowledge-loop/governance/index.ts
// Sprint K4.2-A — AT24 Knowledge Governance: server-only barrel.
//
// INV-1 / boundary discipline (same as ../knowledge/index.ts): this module
// is server-only. `CandidateService` is the ONLY writer of `KnowledgeCandidate`
// — it never touches `Knowledge`/`KnowledgeChunk`. There is no
// `governance-service.ts` (approve/reject/publishNewVersion) yet — that is
// K4.2-B, not built here. The Prisma adapter is dynamically imported so a
// bundle that tree-shakes this barrel never pulls the DB client.

export { CandidateService } from "./candidate-service";
export type { CandidateServiceDeps } from "./candidate-service";
export { scanCandidatePrivacy, scanCandidateForbiddenLanguage } from "./privacy-scan";
export type { PrivacyScanResult } from "./privacy-scan";
export type {
  CandidateStorePort,
  CreateCandidateInput,
  EmbeddingPort,
  VectorHit,
  VectorSearchPort,
  VectorSearchQuery,
} from "./ports";

/**
 * Default production CandidateService — Prisma candidate store + the exact
 * K1 Gemini embedding provider + eligibility-safe VectorRepository search
 * (both reused from ../knowledge, no second copy). Lazily constructed so
 * importing the barrel opens no DB connection.
 */
export async function createCandidateService() {
  const { CandidateService } = await import("./candidate-service");
  const { PrismaCandidateStore } = await import("./prisma-adapters");
  const { PrismaVectorSearch, GeminiEmbeddingAdapter } = await import(
    "../knowledge/prisma-backend"
  );
  return new CandidateService({
    store: new PrismaCandidateStore(),
    embed: new GeminiEmbeddingAdapter(),
    vectors: new PrismaVectorSearch(),
  });
}
