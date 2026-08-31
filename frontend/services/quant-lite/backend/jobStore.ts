/**
 * Q0.9 Part 21 - result persistence. Per the sprint's own instruction
 * ("do NOT immediately create a large new database system... use the
 * safest existing project persistence mechanism"), this reuses the
 * pattern this program already uses for backtest output (Q0.6 wrote its
 * ledgers to quant-engine/output/*.json) instead of adding a new Prisma
 * model/migration. Each job is one JSON file:
 *
 *   quant-engine/output/jobs/<jobId>.json
 *
 * jobId is always a server-generated UUID (crypto.randomUUID(), never
 * taken from client input) and every read/write path validates it against
 * a strict UUID regex before touching the filesystem - this is what
 * prevents path traversal (Q0.9.36) without needing per-call sanitization
 * logic scattered across callers.
 *
 * Known limitation (documented in Q0.9_JOB_LIFECYCLE.md): this is a
 * single-instance, single-filesystem store. It is correct for the
 * current single dev-server deployment and wrong for a future multi-
 * instance deployment, which would need a real shared store (Postgres
 * via the existing Prisma schema, most likely) - noted explicitly as a
 * Q1 follow-up, not solved here.
 */
import fs from "node:fs";
import path from "node:path";
import type { BacktestJobRecord } from "@/types/quant-lite-job";
import { JOBS_DIR } from "./repoPaths";

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

function ensureJobsDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function recordPath(jobId: string): string {
  if (!isValidJobId(jobId)) throw new Error(`refusing to touch filesystem for invalid jobId: ${jobId}`);
  // path.join + a pre-validated UUID-only jobId means the resulting path
  // can never escape JOBS_DIR - no ../ or separator characters survive
  // the regex check above.
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function configPath(jobId: string): string {
  if (!isValidJobId(jobId)) throw new Error(`refusing to touch filesystem for invalid jobId: ${jobId}`);
  return path.join(JOBS_DIR, `${jobId}.config.json`);
}

function resultPath(jobId: string): string {
  if (!isValidJobId(jobId)) throw new Error(`refusing to touch filesystem for invalid jobId: ${jobId}`);
  return path.join(JOBS_DIR, `${jobId}.result.json`);
}

export function createJob(record: BacktestJobRecord): void {
  ensureJobsDir();
  fs.writeFileSync(recordPath(record.jobId), JSON.stringify(record, null, 2), "utf-8");
}

export function getJob(jobId: string): BacktestJobRecord | null {
  if (!isValidJobId(jobId)) return null;
  try {
    const raw = fs.readFileSync(recordPath(jobId), "utf-8");
    return JSON.parse(raw) as BacktestJobRecord;
  } catch {
    return null;
  }
}

export function updateJob(jobId: string, patch: Partial<BacktestJobRecord>): BacktestJobRecord | null {
  const existing = getJob(jobId);
  if (!existing) return null;
  const updated: BacktestJobRecord = { ...existing, ...patch };
  fs.writeFileSync(recordPath(jobId), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

/**
 * Idempotency lookup (Q0.9.26). Job count is expected to stay small
 * (single-operator dev tool, not a public multi-tenant service yet), so a
 * directory scan is a deliberate, documented simplification rather than
 * an indexed lookup - noted in Q0.9_JOB_LIFECYCLE.md.
 */
export function findActiveJobByRequestHash(requestHash: string): BacktestJobRecord | null {
  ensureJobsDir();
  const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json") && !f.includes(".config.") && !f.includes(".result."));
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), "utf-8")) as BacktestJobRecord;
      if (record.requestHash === requestHash && record.status !== "FAILED" && record.status !== "CANCELLED") {
        return record;
      }
    } catch {
      // corrupt/partial file - skip rather than fail the whole lookup
    }
  }
  return null;
}

export function writeJobConfig(jobId: string, config: unknown): string {
  ensureJobsDir();
  const p = configPath(jobId);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), "utf-8");
  return p;
}

export function jobResultOutPath(jobId: string): string {
  ensureJobsDir();
  return resultPath(jobId);
}

export function readJobResultFile(jobId: string): unknown | null {
  try {
    const raw = fs.readFileSync(resultPath(jobId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
