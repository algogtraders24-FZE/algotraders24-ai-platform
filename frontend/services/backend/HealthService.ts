// services/backend/HealthService.ts
// Sprint 14A - Backend Foundation: health report + system status.
// Sprint 14D - Database subsystem now reflects a real connectivity probe
// (prisma.$queryRaw) instead of a static feature flag, and reports the
// active repository mode (prisma | mock).
import type {
  HealthReport,
  SystemStatusReport,
  SubsystemStatus,
  ServiceHealth,
} from "@/types/backend";
import {
  VERSION,
  SERVER_START_TIME,
  FEATURE_FLAGS,
  getEnvironment,
  SUBSYSTEM_LABELS,
} from "@/config/backend.config";
import {
  isDatabaseReachable,
  isDatabaseReachableCached,
} from "@/lib/db-health";
import { resolveRepositoryMode } from "@/config/repository.config";

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

  private sub(
    key: keyof typeof SUBSYSTEM_LABELS,
    health: ServiceHealth,
    detail: string
  ): SubsystemStatus {
    return { name: SUBSYSTEM_LABELS[key], health, detail };
  }

  private build(dbReachable: boolean): SystemStatusReport {
    const mode = resolveRepositoryMode();

    const dbHealth: ServiceHealth = dbReachable ? "operational" : "down";
    const dbDetail = dbReachable
      ? `Connected (Postgres, repositories: ${mode})`
      : "Unreachable - repositories degraded to mock";

    const aiHealth: ServiceHealth = FEATURE_FLAGS.realAiProviders
      ? "operational"
      : "unknown";

    const persistenceNote = mode === "prisma" ? "Persisted" : "Mock mode";

    const subsystems = {
      database: this.sub("database", dbHealth, dbDetail),
      aiProviders: this.sub("aiProviders", aiHealth, "Gemini 2.5 Flash active"),
      automation: this.sub("automation", "operational", `Automation engine running (${persistenceNote})`),
      knowledge: this.sub("knowledge", "operational", `Knowledge base active (${persistenceNote})`),
      agents: this.sub("agents", "operational", `Agent framework active (${persistenceNote})`),
      billing: this.sub("billing", "operational", `Billing active (${persistenceNote})`),
      publishing: this.sub("publishing", "operational", "Publishing engine active"),
    };

    const healths = Object.values(subsystems).map((s) => s.health);
    let overall: ServiceHealth = "operational";
    if (healths.some((h) => h === "down")) overall = "degraded";
    if (healths.every((h) => h === "down")) overall = "down";

    return {
      ...subsystems,
      overallHealth: overall,
      timestamp: new Date().toISOString(),
    };
  }

  // Real connectivity probe. Preferred entry point for API routes.
  async getSystemStatusAsync(): Promise<SystemStatusReport> {
    const reachable = await isDatabaseReachable();
    return this.build(reachable);
  }

  // Synchronous variant, kept for existing callers. Reads the cached probe
  // result rather than issuing a query.
  getSystemStatus(): SystemStatusReport {
    return this.build(isDatabaseReachableCached());
  }
}

export const healthService = new HealthService();