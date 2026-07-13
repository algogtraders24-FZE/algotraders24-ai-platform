// lib/db-health.ts
// Sprint 14D Phase 1 - Database connectivity probe with a cached result.
// Repository resolution is synchronous, so the async ping runs once and its
// outcome is cached. Callers read the cached flag; a background probe refreshes
// it. Also backs HealthService.getSystemStatus() with a real check.
import { prisma } from "@/lib/prisma";

type DbState = "unknown" | "up" | "down";

let state: DbState = "unknown";
let lastCheckedAt = 0;
let inFlight: Promise<boolean> | null = null;

const TTL_MS = 30_000;

// Performs the real connectivity check.
async function probe(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    state = "up";
    return true;
  } catch {
    state = "down";
    return false;
  } finally {
    lastCheckedAt = Date.now();
    inFlight = null;
  }
}

// Async: awaits a fresh result when the cache is cold or stale.
export async function isDatabaseReachable(): Promise<boolean> {
  const fresh = Date.now() - lastCheckedAt < TTL_MS;
  if (state !== "unknown" && fresh) {
    return state === "up";
  }
  if (!inFlight) {
    inFlight = probe();
  }
  return inFlight;
}

// Sync: reads the cached verdict and kicks off a refresh when stale.
// Used by RepositoryFactory, which cannot await.
export function isDatabaseReachableCached(): boolean {
  const stale = Date.now() - lastCheckedAt >= TTL_MS;
  if (state === "unknown" || stale) {
    if (!inFlight) {
      inFlight = probe();
    }
  }
  // Optimistic while unknown: DATABASE_URL present implies an intended DB.
  if (state === "unknown") {
    return Boolean(process.env.DATABASE_URL);
  }
  return state === "up";
}

// Eager warm-up so the first request already has a verdict.
export function warmDatabaseProbe(): void {
  if (state === "unknown" && !inFlight) {
    inFlight = probe();
  }
}

export function databaseState(): DbState {
  return state;
}