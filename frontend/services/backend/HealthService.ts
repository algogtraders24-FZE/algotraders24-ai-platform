// services/backend/HealthService.ts
// Sprint 14A - Backend Foundation: health report + system status.
// Sprint 14D - Database subsystem now reflects a real connectivity probe
// (prisma.$queryRaw) instead of a static feature flag, and reports the
// active repository mode (prisma | mock).
//
// Sprint L2.7 - Phase 5: the other 5 subsystems (previously aiProviders/
// automation/knowledge/agents/billing/publishing, all hardcoded
// "operational" - see the L2.7 audit) are replaced with 6 real checks:
// database, aiProvider, vectorStore, paymentProvider, storage,
// backgroundJobs. Every one is either a live probe or an honestly-disclosed
// fact (a key is/isn't configured; no background job processor exists in
// this deployment at all) - never a default "operational" for something
// that was never actually checked.
import type {
  HealthReport,
  SystemStatusReport,
  SubsystemStatus,
  ServiceHealth,
} from "@/types/backend";
import {
  VERSION,
  SERVER_START_TIME,
  getEnvironment,
  SUBSYSTEM_LABELS,
} from "@/config/backend.config";
import {
  isDatabaseReachable,
  isDatabaseReachableCached,
} from "@/lib/db-health";
import { resolveRepositoryMode } from "@/config/repository.config";
import { prisma } from "@/lib/prisma";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";

async function checkVectorExtension(dbReachable: boolean): Promise<SubsystemStatus> {
  if (!dbReachable) {
    return { name: SUBSYSTEM_LABELS.vectorStore, health: "down", detail: "Database unreachable - cannot check pgvector" };
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists
    `;
    const installed = rows[0]?.exists === true;
    return installed
      ? { name: SUBSYSTEM_LABELS.vectorStore, health: "operational", detail: "pgvector extension installed" }
      : { name: SUBSYSTEM_LABELS.vectorStore, health: "down", detail: "pgvector extension is not installed" };
  } catch {
    return { name: SUBSYSTEM_LABELS.vectorStore, health: "down", detail: "Could not query pg_extension" };
  }
}

async function checkStorage(dbReachable: boolean): Promise<SubsystemStatus> {
  // This deployment has no external object/blob store - uploaded documents
  // are parsed to text and persisted directly in Postgres (Knowledge /
  // KnowledgeChunk). "Storage" health is therefore a real query against
  // that table, disclosed as DB-backed rather than implying an S3-style
  // store that doesn't exist.
  if (!dbReachable) {
    return { name: SUBSYSTEM_LABELS.storage, health: "down", detail: "Database unreachable" };
  }
  try {
    const [count, agg] = await Promise.all([
      prisma.knowledge.count({ where: { deletedAt: null } }),
      prisma.knowledge.aggregate({ where: { deletedAt: null }, _sum: { documentSize: true } }),
    ]);
    const mb = Math.round(((agg._sum.documentSize ?? 0) / (1024 * 1024)) * 100) / 100;
    return {
      name: SUBSYSTEM_LABELS.storage,
      health: "operational",
      detail: `DB-backed document storage (no external object store) - ${count} documents, ${mb} MB`,
    };
  } catch {
    return { name: SUBSYSTEM_LABELS.storage, health: "down", detail: "Could not query document storage" };
  }
}

function checkAiProvider(): SubsystemStatus {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  return {
    name: SUBSYSTEM_LABELS.aiProvider,
    health: configured ? "operational" : "unknown",
    detail: configured ? "Gemini API key configured" : "GEMINI_API_KEY is not set",
  };
}

function checkPaymentProvider(): SubsystemStatus {
  const stripe = stripeProvider.isConfigured();
  const nowPayments = nowPaymentsProvider.isConfigured();
  const configured = stripe || nowPayments;
  const parts = [
    `Stripe: ${stripe ? "configured" : "not configured"}`,
    `NOWPayments: ${nowPayments ? "configured" : "not configured"}`,
  ];
  return {
    name: SUBSYSTEM_LABELS.paymentProvider,
    health: configured ? "operational" : "unknown",
    detail: parts.join(", "),
  };
}

function checkBackgroundJobs(): SubsystemStatus {
  // Honest disclosure, not a probe: this codebase has Workflow/WorkflowRun/
  // WorkflowQueueItem data models but no async worker, cron, or queue
  // consumer anywhere that actually processes them - confirmed by the
  // L2.7 audit (no queue/worker/cron infrastructure exists). Reporting
  // "operational" here would be exactly the fabrication this sprint exists
  // to remove.
  return {
    name: SUBSYSTEM_LABELS.backgroundJobs,
    health: "unknown",
    detail: "No background job processor is running in this deployment (no queue/worker/cron infrastructure exists)",
  };
}

export class HealthService {
  getUptimeSeconds(): number {
    return Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  }

  getHealth(): HealthReport {
    return {
      status: "operational",
      version: VERSION.platformVersion,
      environment: getEnvironment(),
      timestamp: new Date().toISOString(),
      uptime: this.getUptimeSeconds(),
    };
  }

  private dbSubsystem(dbReachable: boolean): SubsystemStatus {
    const mode = resolveRepositoryMode();
    const health: ServiceHealth = dbReachable ? "operational" : "down";
    const detail = dbReachable
      ? `Connected (Postgres, repositories: ${mode})`
      : "Unreachable - repositories degraded to mock";
    return { name: SUBSYSTEM_LABELS.database, health, detail };
  }

  private overallOf(subsystems: SubsystemStatus[]): ServiceHealth {
    const healths = subsystems.map((s) => s.health);
    if (healths.every((h) => h === "down")) return "down";
    if (healths.some((h) => h === "down")) return "degraded";
    return "operational";
  }

  // Real connectivity probe. Preferred entry point for API routes.
  async getSystemStatusAsync(): Promise<SystemStatusReport> {
    const dbReachable = await isDatabaseReachable();
    const [vectorStore, storage] = await Promise.all([
      checkVectorExtension(dbReachable),
      checkStorage(dbReachable),
    ]);

    const subsystems: SystemStatusReport = {
      database: this.dbSubsystem(dbReachable),
      aiProvider: checkAiProvider(),
      vectorStore,
      paymentProvider: checkPaymentProvider(),
      storage,
      backgroundJobs: checkBackgroundJobs(),
      overallHealth: "operational",
      timestamp: new Date().toISOString(),
    };
    subsystems.overallHealth = this.overallOf([
      subsystems.database,
      subsystems.aiProvider,
      subsystems.vectorStore,
      subsystems.paymentProvider,
      subsystems.storage,
      subsystems.backgroundJobs,
    ]);
    return subsystems;
  }

  // Synchronous variant, kept for existing callers - reads the cached DB
  // probe rather than issuing a query; the other checks are cheap/sync-safe
  // (env presence) or degrade to "down" if the DB is known-unreachable.
  getSystemStatus(): SystemStatusReport {
    const dbReachable = isDatabaseReachableCached();
    const subsystems: SystemStatusReport = {
      database: this.dbSubsystem(dbReachable),
      aiProvider: checkAiProvider(),
      vectorStore: dbReachable
        ? { name: SUBSYSTEM_LABELS.vectorStore, health: "unknown", detail: "Use getSystemStatusAsync() for a live pgvector check" }
        : { name: SUBSYSTEM_LABELS.vectorStore, health: "down", detail: "Database unreachable" },
      paymentProvider: checkPaymentProvider(),
      storage: dbReachable
        ? { name: SUBSYSTEM_LABELS.storage, health: "unknown", detail: "Use getSystemStatusAsync() for a live storage check" }
        : { name: SUBSYSTEM_LABELS.storage, health: "down", detail: "Database unreachable" },
      backgroundJobs: checkBackgroundJobs(),
      overallHealth: "operational",
      timestamp: new Date().toISOString(),
    };
    subsystems.overallHealth = this.overallOf([
      subsystems.database,
      subsystems.aiProvider,
      subsystems.vectorStore,
      subsystems.paymentProvider,
      subsystems.storage,
      subsystems.backgroundJobs,
    ]);
    return subsystems;
  }
}

export const healthService = new HealthService();
