// services/automation/automation-repository.ts
// AT24 Automation (MVP) - the ONLY module that reads/writes the
// automations / automation_definition_versions / automation_runs /
// automation_step_runs / automation_artifacts tables. Server-only.
//
// LOCKED (AUTOMATION_DATA_MODEL.md §1): AutomationDefinitionVersion,
// AutomationStepRun and AutomationArtifact are append-only - this module
// exposes create/append methods for them, never update/delete. AutomationRun
// has a narrow `patchRun` for status + terminal fields, and is never patched
// after it is terminal (the caller enforces that with the state machine).
//
// Mirrors services/agent-framework/runtime/agent-run.repository.ts: direct
// Prisma, no in-memory variant. The validate-automation-* suite is
// DB-touching with per-process synthetic users (same house style as
// validate-agent-*).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  AutomationStatus,
  AutomationTriggerType,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationStepKind,
  AutomationStepRunStatus,
  AutomationArtifactKind,
} from "@/lib/generated/prisma/enums";
import type { AutomationWorkflowDefinition } from "@/types/automation";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const asNullableJson = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue);

// ── inputs ───────────────────────────────────────────────────────────────

export interface CreateAutomationInput {
  userId: string;
  name: string;
  description: string;
  timezone: string;
  templateId: string | null;
  definition: AutomationWorkflowDefinition;
  triggerDenorm: TriggerDenorm;
}

export interface TriggerDenorm {
  triggerType: AutomationTriggerType;
  slot: string | null;
  daysOfWeek: string[];
  runAt: Date | null;
}

export interface AddVersionInput {
  automationId: string;
  createdBy: string;
  definition: AutomationWorkflowDefinition;
  triggerDenorm: TriggerDenorm;
}

export interface CreateRunInput {
  automationId: string;
  definitionVersionId: string;
  userId: string;
  requesterId: string;
  trigger: AutomationRunTrigger;
  scheduledFor: Date | null;
}

export interface AppendStepRunInput {
  automationRunId: string;
  stepId: string;
  index: number;
  kind: AutomationStepKind;
}

export interface PatchStepRunInput {
  status?: AutomationStepRunStatus;
  agentRunId?: string | null;
  articleId?: string | null;
  artifactId?: string | null;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  reason?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  creditsUsed?: number;
}

export interface PatchRunInput {
  status?: AutomationRunStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  creditsUsed?: number;
  error?: unknown;
  outputRef?: unknown;
  contextSnapshot?: unknown;
  cancelRequestedAt?: Date | null;
}

// ── repository ───────────────────────────────────────────────────────────

export const automationRepository = {
  // -- automation + versions -------------------------------------------------

  async createAutomationWithV1(input: CreateAutomationInput) {
    return prisma.$transaction(async (tx) => {
      const automation = await tx.automation.create({
        data: {
          userId: input.userId,
          name: input.name,
          description: input.description,
          status: "DRAFT",
          timezone: input.timezone,
          templateId: input.templateId,
        },
      });
      const version = await tx.automationDefinitionVersion.create({
        data: {
          automationId: automation.id,
          version: 1,
          definition: asJson(input.definition),
          triggerType: input.triggerDenorm.triggerType,
          slot: input.triggerDenorm.slot,
          daysOfWeek: input.triggerDenorm.daysOfWeek,
          runAt: input.triggerDenorm.runAt,
          createdBy: input.userId,
        },
      });
      const updated = await tx.automation.update({
        where: { id: automation.id },
        data: { activeVersionId: version.id },
      });
      return { automation: updated, version };
    });
  },

  async addVersion(input: AddVersionInput) {
    return prisma.$transaction(async (tx) => {
      const last = await tx.automationDefinitionVersion.findFirst({
        where: { automationId: input.automationId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;
      const version = await tx.automationDefinitionVersion.create({
        data: {
          automationId: input.automationId,
          version: nextVersion,
          definition: asJson(input.definition),
          triggerType: input.triggerDenorm.triggerType,
          slot: input.triggerDenorm.slot,
          daysOfWeek: input.triggerDenorm.daysOfWeek,
          runAt: input.triggerDenorm.runAt,
          createdBy: input.createdBy,
        },
      });
      const automation = await tx.automation.update({
        where: { id: input.automationId },
        data: { activeVersionId: version.id },
      });
      return { automation, version };
    });
  },

  async getAutomationForUser(id: string, userId: string) {
    return prisma.automation.findFirst({
      where: { id, userId, deletedAt: null },
      include: { activeVersion: true },
    });
  },

  async listAutomationsForUser(userId: string, opts: { includeArchived?: boolean } = {}) {
    return prisma.automation.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(opts.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
      },
      orderBy: { createdAt: "desc" },
      include: { activeVersion: true },
    });
  },

  async countActiveAndDraft(userId: string): Promise<number> {
    return prisma.automation.count({
      where: { userId, deletedAt: null, status: { in: ["ACTIVE", "DRAFT", "PAUSED"] } },
    });
  },

  async getVersion(id: string) {
    return prisma.automationDefinitionVersion.findUnique({ where: { id } });
  },

  async patchAutomation(
    id: string,
    data: {
      name?: string;
      description?: string;
      timezone?: string;
      status?: AutomationStatus;
      nextRunAt?: Date | null;
      lastRunAt?: Date | null;
    },
  ) {
    return prisma.automation.update({ where: { id }, data });
  },

  // -- runs ----------------------------------------------------------------

  async createRun(input: CreateRunInput) {
    return prisma.automationRun.create({
      data: {
        automationId: input.automationId,
        definitionVersionId: input.definitionVersionId,
        userId: input.userId,
        requesterId: input.requesterId,
        status: "QUEUED",
        trigger: input.trigger,
        scheduledFor: input.scheduledFor,
      },
    });
  },

  /** Insert a scheduled run, swallowing the unique-constraint race
   *  (automationId, scheduledFor) - returns null when the slot is already
   *  taken (at-least-once cron dedup, AUTOMATION_EXECUTION_CONTRACT §7). */
  async createScheduledRunIfAbsent(input: CreateRunInput): Promise<{ id: string } | null> {
    try {
      return await prisma.automationRun.create({
        data: {
          automationId: input.automationId,
          definitionVersionId: input.definitionVersionId,
          userId: input.userId,
          requesterId: input.requesterId,
          status: "QUEUED",
          trigger: "schedule",
          scheduledFor: input.scheduledFor,
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  },

  async getRun(runId: string) {
    return prisma.automationRun.findUnique({ where: { id: runId } });
  },

  async getRunForUser(runId: string, userId: string) {
    return prisma.automationRun.findFirst({ where: { id: runId, userId } });
  },

  async getRunWithSteps(runId: string, userId: string) {
    return prisma.automationRun.findFirst({
      where: { id: runId, userId },
      include: {
        steps: { orderBy: { index: "asc" } },
        automation: { select: { name: true } },
        definitionVersion: { select: { version: true, definition: true } },
      },
    });
  },

  async listRunsForAutomation(automationId: string, userId: string, limit: number) {
    return prisma.automationRun.findMany({
      where: { automationId, userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
      include: { steps: { select: { id: true } } },
    });
  },

  async hasActiveRun(automationId: string): Promise<boolean> {
    const n = await prisma.automationRun.count({
      where: { automationId, status: { in: ["QUEUED", "RUNNING"] } },
    });
    return n > 0;
  },

  async automationHasAnyRun(automationId: string): Promise<boolean> {
    const n = await prisma.automationRun.count({ where: { automationId } });
    return n > 0;
  },

  async patchRun(runId: string, patch: PatchRunInput) {
    return prisma.automationRun.update({
      where: { id: runId },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.creditsUsed !== undefined ? { creditsUsed: patch.creditsUsed } : {}),
        ...(patch.error !== undefined ? { error: asNullableJson(patch.error) } : {}),
        ...(patch.outputRef !== undefined ? { outputRef: asNullableJson(patch.outputRef) } : {}),
        ...(patch.contextSnapshot !== undefined ? { contextSnapshot: asNullableJson(patch.contextSnapshot) } : {}),
        ...(patch.cancelRequestedAt !== undefined ? { cancelRequestedAt: patch.cancelRequestedAt } : {}),
      },
    });
  },

  /** Conditional claim used by the dispatch catch-up pass: flip QUEUED ->
   *  RUNNING only if still QUEUED. `count === 0` => another handler won it. */
  async claimQueuedRun(runId: string): Promise<boolean> {
    const res = await prisma.automationRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    return res.count === 1;
  },

  async listResumableRuns(olderThanMs: number, limit: number) {
    const cutoff = new Date(Date.now() - olderThanMs);
    return prisma.automationRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
  },

  // -- due-set for the scheduler -----------------------------------------

  /** ACTIVE automations whose active version targets `slot`. The caller
   *  applies the weekly/once calendar filter and the dedup/concurrency
   *  guards (they need the slot instant + IST calendar, not SQL). */
  async activeAutomationsForSlot(slot: string) {
    return prisma.automation.findMany({
      where: { status: "ACTIVE", deletedAt: null, activeVersion: { slot } },
      include: { activeVersion: true },
      orderBy: { nextRunAt: "asc" },
    });
  },

  // -- step runs ---------------------------------------------------------

  async appendStepRun(input: AppendStepRunInput) {
    return prisma.automationStepRun.create({
      data: {
        automationRunId: input.automationRunId,
        stepId: input.stepId,
        index: input.index,
        kind: input.kind,
        status: "PENDING",
      },
    });
  },

  async patchStepRun(id: string, patch: PatchStepRunInput) {
    return prisma.automationStepRun.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.agentRunId !== undefined ? { agentRunId: patch.agentRunId } : {}),
        ...(patch.articleId !== undefined ? { articleId: patch.articleId } : {}),
        ...(patch.artifactId !== undefined ? { artifactId: patch.artifactId } : {}),
        ...(patch.input !== undefined ? { input: asNullableJson(patch.input) } : {}),
        ...(patch.output !== undefined ? { output: asNullableJson(patch.output) } : {}),
        ...(patch.error !== undefined ? { error: asNullableJson(patch.error) } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.creditsUsed !== undefined ? { creditsUsed: patch.creditsUsed } : {}),
      },
    });
  },

  async stepRunsForRun(runId: string) {
    return prisma.automationStepRun.findMany({
      where: { automationRunId: runId },
      orderBy: { index: "asc" },
    });
  },

  // -- artifacts -------------------------------------------------------

  async appendArtifact(input: {
    userId: string;
    automationRunId: string;
    stepRunId: string;
    kind: AutomationArtifactKind;
    title: string;
    payload: unknown;
  }) {
    return prisma.automationArtifact.create({
      data: {
        userId: input.userId,
        automationRunId: input.automationRunId,
        stepRunId: input.stepRunId,
        kind: input.kind,
        title: input.title,
        payload: asJson(input.payload),
      },
    });
  },

  async listArtifactsForUser(userId: string, limit = 25) {
    return prisma.automationArtifact.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
  },

  // -- stats -----------------------------------------------------------

  async runStatsSince(automationId: string, since: Date) {
    const rows = await prisma.automationRun.groupBy({
      by: ["status"],
      where: { automationId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { creditsUsed: true },
    });
    let runs = 0;
    let succeeded = 0;
    let failed = 0;
    let creditsUsed = 0;
    for (const r of rows) {
      runs += r._count._all;
      creditsUsed += r._sum.creditsUsed ?? 0;
      if (r.status === "SUCCEEDED") succeeded += r._count._all;
      if (r.status === "FAILED" || r.status === "CREDIT_BLOCKED") failed += r._count._all;
    }
    return { runs, succeeded, failed, creditsUsed };
  },

  // -- test-only -----------------------------------------------------

  async _deleteAllForUser(userId: string): Promise<number> {
    const res = await prisma.automation.deleteMany({ where: { userId } });
    await prisma.automationArtifact.deleteMany({ where: { userId } });
    return res.count;
  },
};

export type AutomationRow = Awaited<ReturnType<typeof automationRepository.getAutomationForUser>>;
export type AutomationRunRow = Awaited<ReturnType<typeof automationRepository.getRun>>;
