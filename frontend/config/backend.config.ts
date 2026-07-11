// config/backend.config.ts
// Sprint 14A — Backend Foundation
// Central backend configuration: version, environment, subsystems, feature flags.

import type { Environment, VersionInfo, LogLevel } from "@/types/backend";

export const VERSION: VersionInfo = {
  platformVersion: "0.4.0",
  buildVersion: "2026.07.11",
  release: "Release 0.4",
  sprint: "Sprint 14A",
};

// Server process start time — used to derive uptime.
export const SERVER_START_TIME = Date.now();

export function getEnvironment(): Environment {
  const env = (process.env.NODE_ENV ?? "development").toLowerCase();
  if (env === "production") return "production";
  if (env === "staging") return "staging";
  return "development";
}

// Subsystems reported by /api/system/status
export const SUBSYSTEMS = [
  "database",
  "aiProviders",
  "automation",
  "knowledge",
  "agents",
  "billing",
  "publishing",
] as const;

export type SubsystemKey = (typeof SUBSYSTEMS)[number];

export const SUBSYSTEM_LABELS: Record<SubsystemKey, string> = {
  database: "Database",
  aiProviders: "AI Providers",
  automation: "Automation Engine",
  knowledge: "Knowledge Base",
  agents: "AI Agents",
  billing: "Billing",
  publishing: "Publishing Engine",
};

// Feature flags — everything future is OFF until wired.
export const FEATURE_FLAGS = {
  databaseConnected: true,
  authEnabled: false,
  stripeEnabled: false,
  nowPaymentsEnabled: false,
  redisEnabled: false,
  realAiProviders: true, // Gemini already live in frontend
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// Logging configuration
export const LOG_CONFIG = {
  minLevel: "DEBUG" as LogLevel,
  enabledInProduction: true,
  levelPriority: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  } as Record<LogLevel, number>,
} as const;

// Standard error codes used across the backend.
export const ERROR_CODES = {
  INTERNAL: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  BAD_REQUEST: "BAD_REQUEST",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

