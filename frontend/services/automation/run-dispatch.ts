// services/automation/run-dispatch.ts
// AT24 Automation (MVP) - the manual-run and scheduled-slot entry points.
// Thin orchestration over automation-service (ownership/state), the
// automation repository (dedup/concurrency guards) and dispatcher.ts (the
// executor).

import { logger } from "@/services/backend/Logger";
import { AppError } from "@/services/backend/ErrorHandler";
import { ERROR_CODES } from "@/config/backend.config";
import { prisma } from "@/lib/prisma";
import type { AutomationWorkflowDefinition, AutomationStatus } from "@/types/automation";
import { automationRepository } from "./automation-repository";
import { automationService } from "./automation-service";
import { dispatchAutomationRun } from "./dispatcher";
import { isDueForSlot } from "./scheduler";
import { getSlot } from "@/config/automation-slots";

const log = logger.child("automation-run-dispatch");

/** A RUNNING/QUEUED run older than this is considered stalled and is resumed
 *  by the next slot's catch-up pass before new dispatch. */
const RESUME_AFTER_MS = 2 * 60 * 1000;
const DISPATCH_BATCH = 25;

// Same non-blocking pg_try_advisory_xact_lock + bounded retry design as
// lib/security/checkoutRateLimit.ts.
const MANUAL_RUN_LOCK_RETRY_ATTEMPTS = 20;
const MANUAL_RUN_LOCK_RETRY_BASE_MS = 30;
const MANUAL_RUN_LOCK_RETRY_MAX_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AutomationRunInProgressError extends AppError {
  constructor(runId: string) {
    super(ERROR_CODES.CONFLICT, "A run is already in progress for this automation", 409, { runId });
    this.name = "AutomationRunInProgressError";
  }
}
export class AutomationNotRunnableError extends AppError {
  constructor(status: AutomationStatus) {
    super(ERROR_CODES.CONFLICT, `A ${status} automation cannot be run`, 409, { status });
    this.name = "AutomationNotRunnableError";
  }
}

/** "Run now". Creates a manual AutomationRun and drives it, bounded by the
 *  caller's wall-clock budget. Returns immediately with the run id if the
 *  drive does not finish in one pass. */
export async function triggerManualRun(userId: string, automationId: string): Promise<{ runId: string; status: string }> {
  const automation = await automationService.requireOwned(userId, automationId);
  const status = automation.status as AutomationStatus;
  if (status !== "ACTIVE" && status !== "PAUSED") throw new AutomationNotRunnableError(status);
  if (!automation.activeVersionId) throw new AppError(ERROR_CODES.VALIDATION, "automation has no active definition", 422);

  // hasActiveRun() + createRun() used to be a plain check-then-act with no
  // lock - manual runs have scheduledFor: null, so the (automationId,
  // scheduledFor) unique index that protects SCHEDULED dispatch doesn't
  // apply here. A double-click or client retry on "Run Now" within that
  // race window could create two QUEUED runs, each independently
  // dispatched (two real automation runs, two real credit-charging
  // AgentRuns, for one user action). Now serialized per-automationId via
  // a non-blocking advisory lock, same pattern as
  // lib/security/checkoutRateLimit.ts.
  const claim = await claimManualRunSlot(automationId, userId, automation.activeVersionId);
  if (claim === "in_progress") {
    const runs = await automationRepository.listRunsForAutomation(automationId, userId, 1);
    throw new AutomationRunInProgressError(runs[0]?.id ?? "unknown");
  }

  await safeDispatch(claim.id);
  const after = await automationRepository.getRun(claim.id);
  return { runId: claim.id, status: after?.status ?? "QUEUED" };
}

async function claimManualRunSlotOnce(
  automationId: string,
  userId: string,
  definitionVersionId: string,
): Promise<{ id: string } | "in_progress" | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`automation-manual-run:${automationId}`})) AS acquired
      `;
      if (!acquired) return null;

      const activeCount = await tx.automationRun.count({
        where: { automationId, status: { in: ["QUEUED", "RUNNING"] } },
      });
      if (activeCount > 0) return "in_progress";

      return tx.automationRun.create({
        data: {
          automationId,
          definitionVersionId,
          userId,
          requesterId: userId,
          status: "QUEUED",
          trigger: "manual",
          scheduledFor: null,
        },
        select: { id: true },
      });
    },
    { maxWait: 10_000, timeout: 5_000 },
  );
}

async function claimManualRunSlot(
  automationId: string,
  userId: string,
  definitionVersionId: string,
): Promise<{ id: string } | "in_progress"> {
  for (let attempt = 0; attempt < MANUAL_RUN_LOCK_RETRY_ATTEMPTS; attempt++) {
    const result = await claimManualRunSlotOnce(automationId, userId, definitionVersionId);
    if (result !== null) return result;
    const backoff = Math.min(MANUAL_RUN_LOCK_RETRY_BASE_MS * (attempt + 1), MANUAL_RUN_LOCK_RETRY_MAX_DELAY_MS);
    await sleep(backoff + Math.random() * 20);
  }
  // Every attempt lost the lock race - fail safe as "in progress" rather
  // than falling through to an unserialized create.
  return "in_progress";
}

export interface SlotDispatchResult {
  slot: string;
  now: string;
  resumed: number;
  dispatched: number;
  skipped: { automationId: string; reason: string }[];
  durationMs: number;
}

/** The cron entry point for one slot. Catch-up pass first, then a bounded
 *  batch of newly-due automations. */
export async function dispatchSlot(slotId: string, now: Date = new Date()): Promise<SlotDispatchResult> {
  const startedAt = Date.now();
  const slot = getSlot(slotId);
  if (!slot) throw new AppError(ERROR_CODES.VALIDATION, `unknown slot "${slotId}"`, 422);

  const skipped: { automationId: string; reason: string }[] = [];

  // ── catch-up: resume stalled runs ──
  let resumed = 0;
  const stalled = await automationRepository.listResumableRuns(RESUME_AFTER_MS, DISPATCH_BATCH);
  for (const r of stalled) {
    if (await safeDispatch(r.id)) resumed += 1;
  }

  // ── new dispatch ──
  let dispatched = 0;
  const candidates = await automationRepository.activeAutomationsForSlot(slotId);
  for (const automation of candidates.slice(0, DISPATCH_BATCH)) {
    const version = automation.activeVersion;
    if (!version) {
      skipped.push({ automationId: automation.id, reason: "no active version" });
      continue;
    }
    const def = version.definition as unknown as AutomationWorkflowDefinition;
    const hasAnyRun = await automationRepository.automationHasAnyRun(automation.id);
    const due = isDueForSlot({ def, slot, now, hasAnyRun });
    if (!due.due) {
      skipped.push({ automationId: automation.id, reason: due.reason ?? "not due" });
      continue;
    }
    if (await automationRepository.hasActiveRun(automation.id)) {
      skipped.push({ automationId: automation.id, reason: "run_in_progress" });
      continue;
    }
    const created = await automationRepository.createScheduledRunIfAbsent({
      automationId: automation.id,
      definitionVersionId: version.id,
      userId: automation.userId,
      requesterId: "system:scheduler",
      trigger: "schedule",
      scheduledFor: due.slotInstant,
    });
    if (!created) {
      skipped.push({ automationId: automation.id, reason: "already dispatched this slot" });
      continue;
    }
    if (await safeDispatch(created.id)) dispatched += 1;
  }

  return {
    slot: slotId,
    now: now.toISOString(),
    resumed,
    dispatched,
    skipped,
    durationMs: Date.now() - startedAt,
  };
}

/** Cancel a run - cooperative, observed by the dispatcher between steps. */
export async function requestRunCancellation(userId: string, runId: string): Promise<{ status: string }> {
  const run = await automationRepository.getRunForUser(runId, userId);
  if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, "Automation run not found", 404);
  const terminal = ["SUCCEEDED", "FAILED", "CONDITION_HALTED", "CANCELLED", "CREDIT_BLOCKED"].includes(run.status);
  if (terminal) throw new AppError(ERROR_CODES.CONFLICT, `run is already ${run.status}`, 409);

  if (run.status === "QUEUED") {
    await automationRepository.patchRun(runId, { status: "CANCELLED", cancelRequestedAt: new Date(), completedAt: new Date() });
    return { status: "CANCELLED" };
  }
  await automationRepository.patchRun(runId, { cancelRequestedAt: new Date() });
  return { status: run.status };
}

async function safeDispatch(runId: string): Promise<boolean> {
  try {
    await dispatchAutomationRun(runId);
    return true;
  } catch (err) {
    log.error("dispatchAutomationRun threw", { runId, err: String(err) });
    return false;
  }
}
