// services/knowledge-loop/governance/index.ts
// Sprint K4.2-A/B — AT24 Knowledge Governance: server-only barrel.
//
// INV-1 / boundary discipline (same as ../knowledge/index.ts): this module
// is server-only. `CandidateService` is the ONLY writer of `KnowledgeCandidate`
// — it never touches `Knowledge`/`KnowledgeChunk`. `GovernanceService`
// (K4.2-B) is the ONLY writer of an `active` Knowledge row promoted from a
// candidate, and the ONLY writer of a governance `AuditLog` row. No admin
// route/UI, cron, or analytics emission exists yet (K4.2-C). The Prisma
// adapters are dynamically imported so a bundle that tree-shakes this
// barrel never pulls the DB client.

export { CandidateService } from "./candidate-service";
export type { CandidateServiceDeps } from "./candidate-service";
export { GovernanceService } from "./governance-service";
export type { GovernanceServiceDeps } from "./governance-service";
export { scanCandidatePrivacy, scanCandidateForbiddenLanguage } from "./privacy-scan";
export type { PrivacyScanResult } from "./privacy-scan";
export type {
  ApproveCandidateStoreInput,
  ApproveCandidateStoreResult,
  CandidateStorePort,
  CreateCandidateInput,
  EmbeddingPort,
  GovernanceStorePort,
  PublishNewVersionStoreInput,
  PublishNewVersionStoreResult,
  RejectCandidateStoreInput,
  RejectCandidateStoreResult,
  TransitionKnowledgeStoreInput,
  TransitionKnowledgeStoreResult,
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

/**
 * Default production GovernanceService — Prisma governance store (owns its
 * own atomic transactions, K4.2B-D1) + the existing, unmodified K1
 * `realIngestionPort()` (chunking + embedding after commit). Lazily
 * constructed so importing the barrel opens no DB connection.
 */
export async function createGovernanceService() {
  const { GovernanceService } = await import("./governance-service");
  const { PrismaGovernanceStore } = await import("./prisma-adapters");
  const { realIngestionPort } = await import("../knowledge/ingestion-adapter");
  return new GovernanceService({
    store: new PrismaGovernanceStore(),
    ingestion: realIngestionPort(),
  });
}
