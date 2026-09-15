// services/knowledge-loop/governance/index.ts
// Sprint K4.2-A/B/C — AT24 Knowledge Governance: server-only barrel.
//
// INV-1 / boundary discipline (same as ../knowledge/index.ts): this module
// is server-only. `CandidateService` is the ONLY writer of `KnowledgeCandidate`
// — it never touches `Knowledge`/`KnowledgeChunk`. `GovernanceService`
// (K4.2-B) is the ONLY writer of an `active` Knowledge row promoted from a
// candidate, and the ONLY writer of a governance `AuditLog` row. K4.2-C
// Phase 1 adds admin routes/UI + a freshness-sweep cron + candidate-
// lifecycle analytics emission (both services, optional DI, K4.2C-D1) — it
// does NOT wire propose()/approve() into the K3 orchestrator (Phase 2, not
// started). The Prisma adapters are dynamically imported so a bundle that
// tree-shakes this barrel never pulls the DB client.

export { CandidateService } from "./candidate-service";
export type { CandidateServiceDeps } from "./candidate-service";
export { GovernanceService } from "./governance-service";
export type { GovernanceServiceDeps } from "./governance-service";
export { scanCandidatePrivacy, scanCandidateForbiddenLanguage } from "./privacy-scan";
export type { PrivacyScanResult } from "./privacy-scan";
export {
  listCandidates,
  getCandidateDetail,
  listKnowledge,
} from "./admin-queries";
export type { Page } from "./admin-queries";
export type {
  AnalyticsPort,
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

/** wraps the platform's existing, generic `AnalyticsEventService` (R1.2) as
 *  an `AnalyticsPort` — no second analytics system, best-effort by the
 *  service's own `.record()` contract. */
async function realAnalyticsPort() {
  const { analyticsEventService } = await import("@/services/analytics/AnalyticsEventService");
  return {
    async record(userId: string | null, type: string, metadata?: Record<string, unknown>) {
      await analyticsEventService.record(userId, type as never, metadata);
    },
  };
}

/**
 * Default production CandidateService — Prisma candidate store + the exact
 * K1 Gemini embedding provider + eligibility-safe VectorRepository search
 * (both reused from ../knowledge, no second copy) + the real analytics
 * event service (K4.2-C). Lazily constructed so importing the barrel opens
 * no DB connection.
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
    analytics: await realAnalyticsPort(),
  });
}

/**
 * Default production GovernanceService — Prisma governance store (owns its
 * own atomic transactions, K4.2B-D1) + the existing, unmodified K1
 * `realIngestionPort()` (chunking + embedding after commit) + the real
 * analytics event service (K4.2-C). Lazily constructed so importing the
 * barrel opens no DB connection.
 */
export async function createGovernanceService() {
  const { GovernanceService } = await import("./governance-service");
  const { PrismaGovernanceStore } = await import("./prisma-adapters");
  const { realIngestionPort } = await import("../knowledge/ingestion-adapter");
  return new GovernanceService({
    store: new PrismaGovernanceStore(),
    ingestion: realIngestionPort(),
    analytics: await realAnalyticsPort(),
  });
}
