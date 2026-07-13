// config/repository.config.ts
// Sprint 14D - Repository mode configuration (dependency injection switch).
// mock   -> in-memory repositories (Sprint 14A behaviour)
// prisma -> Prisma/Postgres-backed repositories
// auto   -> Prisma when the database is reachable, otherwise mock (fallback)
import { isDatabaseReachableCached } from "@/lib/db-health";

export type RepositoryMode = "mock" | "prisma" | "auto";

function readMode(): RepositoryMode {
  const raw = (process.env.REPOSITORY_MODE ?? "auto").toLowerCase();
  if (raw === "mock" || raw === "prisma" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export const repositoryConfig = {
  mode: readMode(),

  // Log every repository operation with its execution time.
  enableQueryLogging: process.env.NODE_ENV !== "production",

  // Warn when a query exceeds this threshold (ms).
  slowQueryThresholdMs: Number(process.env.SLOW_QUERY_MS ?? 300),

  // Default page size for paginated queries.
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

// Resolves "auto" into a concrete mode at call time.
// In auto mode this consults the cached database health probe, so a database
// outage degrades the platform to mock repositories instead of failing hard.
export function resolveRepositoryMode(): "mock" | "prisma" {
  if (repositoryConfig.mode === "mock") return "mock";
  if (repositoryConfig.mode === "prisma") return "prisma";
  return isDatabaseReachableCached() ? "prisma" : "mock";
}