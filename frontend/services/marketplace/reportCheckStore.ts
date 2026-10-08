// services/marketplace/reportCheckStore.ts
// Seller self-serve Phase 2: the job queue behind "Checked from the seller's report".
// enqueue (seller route) -> claim (VPS worker, polling over HTTPS) -> complete (VPS worker) -> latestReportCheck (public page).
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { MAX_REPORT_ATTEMPTS, REPORT_LOCK_MINUTES, sanitizeReportCheckResult, safeFailureReason, type ReportCheckResult } from "@/lib/marketplace/reportCheck";

export async function enqueueReportCheck(input: { listingId: string; sellerId: string; storageKey: string; fileName: string; sizeBytes: number }) {
  return prisma.reportCheckJob.create({ data: { ...input, status: "QUEUED" } });
}

/** Atomically hand the oldest waiting job (or one whose worker died) to ONE worker. */
export async function claimNextJob(now: Date = new Date()) {
  for (let i = 0; i < 5; i++) {
    const candidate = await prisma.reportCheckJob.findFirst({
      where: {
        attempts: { lt: MAX_REPORT_ATTEMPTS },
        OR: [{ status: "QUEUED" }, { status: "RUNNING", lockedUntil: { lt: now } }],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;
    const lockedUntil = new Date(now.getTime() + REPORT_LOCK_MINUTES * 60_000);
    // The WHERE re-states the claim condition, so two workers can never both win the same row.
    const won = await prisma.reportCheckJob.updateMany({
      where: { id: candidate.id, attempts: candidate.attempts, status: candidate.status },
      data: { status: "RUNNING", lockedUntil, attempts: { increment: 1 } },
    });
    if (won.count === 1) return { ...candidate, attempts: candidate.attempts + 1 };
  }
  return null;
}

export async function completeJob(jobId: string, outcome: { ok: true; result: unknown } | { ok: false; reason: unknown }): Promise<{ ok: boolean; error?: string }> {
  const job = await prisma.reportCheckJob.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: "NOT_FOUND" };
  if (job.status !== "RUNNING") return { ok: false, error: "NOT_RUNNING" };
  if (outcome.ok) {
    const result = sanitizeReportCheckResult(outcome.result);
    if (!result) {
      await prisma.reportCheckJob.update({ where: { id: jobId }, data: { status: "FAILED", reason: "The report could not be read.", finishedAt: new Date(), lockedUntil: null } });
      return { ok: true };
    }
    await prisma.reportCheckJob.update({ where: { id: jobId }, data: { status: "DONE", result: result as unknown as object, reason: null, finishedAt: new Date(), lockedUntil: null } });
    return { ok: true };
  }
  await prisma.reportCheckJob.update({ where: { id: jobId }, data: { status: "FAILED", reason: safeFailureReason(outcome.reason), finishedAt: new Date(), lockedUntil: null } });
  return { ok: true };
}

export interface PublicReportCheck {
  result: ReportCheckResult;
  fileName: string;
  checkedAt: string;
}

/** What the public listing page shows: the newest finished check for this listing, or null (= "Not checked"). */
export async function latestReportCheck(listingId: string): Promise<PublicReportCheck | null> {
  const job = await withTableFallback(
    () => prisma.reportCheckJob.findFirst({ where: { listingId, status: "DONE" }, orderBy: { finishedAt: "desc" } }),
    null,
  );
  if (!job) return null;
  const result = sanitizeReportCheckResult(job.result);
  if (!result) return null;
  return { result, fileName: job.fileName, checkedAt: (job.finishedAt ?? job.createdAt).toISOString() };
}

/** For the seller's own status line (queued / running / failed reason). */
export async function reportCheckStatusForSeller(listingId: string, sellerId: string) {
  const job = await withTableFallback(
    () => prisma.reportCheckJob.findFirst({ where: { listingId, sellerId }, orderBy: { createdAt: "desc" } }),
    null,
  );
  return job ? { id: job.id, status: job.status, reason: job.reason, fileName: job.fileName } : null;
}
