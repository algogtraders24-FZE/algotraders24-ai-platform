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

// Subsystems reported by /api/system/status - Sprint L2.7 Phase 5. Each
// one is backed by a real check in HealthService; none defaults to
// "operational" without actually probing something.
export const SUBSYSTEMS = [
  "database",
  "aiProvider",
  "vectorStore",
  "paymentProvider",
  "storage",
  "backgroundJobs",
] as const;

export type SubsystemKey = (typeof SUBSYSTEMS)[number];

export const SUBSYSTEM_LABELS: Record<SubsystemKey, string> = {
  database: "Database",
  aiProvider: "AI Provider",
  vectorStore: "Vector Store",
  paymentProvider: "Payment Provider",
  storage: "Storage",
  backgroundJobs: "Background Jobs",
};

// Feature flags — everything future is OFF until wired.
// Sprint L2.7 - Removed stripeEnabled/nowPaymentsEnabled/realAiProviders:
// these were static booleans nothing ever flipped (payment flags were
// hardcoded false forever; realAiProviders hardcoded true regardless of
// whether a key was actually configured) - a real "is this configured"
// answer now comes from the provider itself (StripeProvider.isConfigured(),
// NowPaymentsProvider.isConfigured(), and a live GEMINI_API_KEY check in
// HealthService), not a flag that could drift from reality.
export const FEATURE_FLAGS = {
  databaseConnected: true,
  authEnabled: false,
  redisEnabled: false,
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

