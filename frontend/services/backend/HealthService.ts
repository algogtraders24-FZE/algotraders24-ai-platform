// services/backend/HealthService.ts
// Sprint 14A — Backend Foundation
// Health report + system status (mock subsystem values).

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

  getSystemStatus(): SystemStatusReport {
    const dbHealth: ServiceHealth = FEATURE_FLAGS.databaseConnected
      ? "operational"
      : "down";
    const dbDetail = FEATURE_FLAGS.databaseConnected
      ? "Connected"
      : "Not connected (mock mode)";

    const aiHealth: ServiceHealth = FEATURE_FLAGS.realAiProviders
      ? "operational"
      : "unknown";

    const subsystems = {
      database: this.sub("database", dbHealth, dbDetail),
      aiProviders: this.sub("aiProviders", aiHealth, "Gemini 2.5 Flash active"),
      automation: this.sub("automation", "operational", "Mock engine running"),
      knowledge: this.sub("knowledge", "operational", "Mock RAG foundation"),
      agents: this.sub("agents", "operational", "Agent framework active"),
      billing: this.sub("billing", "operational", "Mock billing active"),
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
}

export const healthService = new HealthService();
