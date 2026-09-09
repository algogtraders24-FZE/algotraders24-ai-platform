// services/automation/automation-service.ts
// AT24 Automation (MVP) - CRUD + lifecycle state machine + definition
// versioning + plan-limit enforcement + list/detail assembly.
//
// LOCKED (AUTOMATION_EXECUTION_CONTRACT.md §2): the automation state machine
// is enforced here, server-side. Every mutation re-checks ownership + the
// current state. `userId` is always the caller's argument (from the server
// session in the route) - never a body value.
//
// This module NEVER executes a run - it delegates that to
// ./dispatcher (which delegates the real work to the Agent Framework).

import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/config/plan-limits";
import type { PlanId } from "@/types/billing";
import { AppError } from "@/services/backend/ErrorHandler";
import { ERROR_CODES } from "@/config/backend.config";
import {
  type AutomationDetail,
  type AutomationListItem,
  type AutomationRunSummary,
  type AutomationStatus,
  type AutomationWorkflowDefinition,
  type AutomationWeekday,
} from "@/types/automation";
import { validateWorkflowDefinition } from "./workflow-validator";
import { normaliseDefinition, triggerDenormFromDefinition } from "./definition";
import { computeNextRunAt } from "./scheduler";
import { automationRepository, type AutomationRow } from "./automation-repository";
import type { Automation, AutomationDefinitionVersion, AutomationRun } from "@/lib/generated/prisma/client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── errors ───────────────────────────────────────────────────────────────

export class AutomationValidationError extends AppError {
  constructor(issues: { path: string; message: string }[]) {
    super(ERROR_CODES.VALIDATION, "The automation definition is invalid", 422, { issues });
    this.name = "AutomationValidationError";
  }
}
export class AutomationNotFoundError extends AppError {
  constructor() {
    super(ERROR_CODES.NOT_FOUND, "Automation not found", 404);
    this.name = "AutomationNotFoundError";
  }
}
export class AutomationStateError extends AppError {
  constructor(from: AutomationStatus, to: string) {
    super(ERROR_CODES.CONFLICT, `Cannot transition automation from ${from} to ${to}`, 409, { from, to });
    this.name = "AutomationStateError";
  }
}
export class AutomationPlanLimitError extends AppError {
  constructor(limit: number) {
    super(ERROR_CODES.FORBIDDEN, `Plan limit reached: at most ${limit} automations`, 403, { limit });
    this.name = "AutomationPlanLimitError";
  }
}

// ── inputs ───────────────────────────────────────────────────────────────

export interface CreateInput {
  userId: string;
  name: string;
  description?: string;
  /** Account timezone; Beta forces IST for scheduled triggers anyway. */
  accountTimezone?: string;
  definition: unknown;
  templateId?: string | null;
}

export interface UpdateInput {
  name?: string;
  description?: string;
  definition?: unknown;
}

// ── plan limit ───────────────────────────────────────────────────────────

async function maxAutomationsFor(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { planId: true } });
  const [sub] = user
    ? await prisma.subscription.findMany({
        where: { userId, deletedAt: null, status: "active" },
        orderBy: { currentPeriodEnd: "desc" },
        take: 1,
        select: { planId: true },
      })
    : [];
  const planId = (sub?.planId ?? user?.planId ?? "free") as PlanId;
  return PLAN_LIMITS[planId]?.maxAutomations ?? PLAN_LIMITS.free.maxAutomations;
}

// ── validation ───────────────────────────────────────────────────────────

function validateOrThrow(raw: unknown): AutomationWorkflowDefinition {
  const result = validateWorkflowDefinition(raw);
  if (!result.ok) throw new AutomationValidationError(result.issues);
  return normaliseDefinition(raw as AutomationWorkflowDefinition);
}

// ── transitions ──────────────────────────────────────────────────────────

const ALLOWED: Record<AutomationStatus, Partial<Record<"activate" | "pause" | "resume" | "archive", AutomationStatus>>> = {
  DRAFT: { activate: "ACTIVE", archive: "ARCHIVED" },
  ACTIVE: { pause: "PAUSED", archive: "ARCHIVED" },
  PAUSED: { resume: "ACTIVE", archive: "ARCHIVED" },
  ARCHIVED: {},
};

// ── service ──────────────────────────────────────────────────────────────

export const automationService = {
  async create(input: CreateInput): Promise<{ id: string; status: AutomationStatus; version: number }> {
    const definition = validateOrThrow(input.definition);

    const limit = await maxAutomationsFor(input.userId);
    const current = await automationRepository.countActiveAndDraft(input.userId);
    if (current >= limit) throw new AutomationPlanLimitError(limit);

    const denorm = triggerDenormFromDefinition(definition);
    const { automation, version } = await automationRepository.createAutomationWithV1({
      userId: input.userId,
      name: input.name.trim() || "Untitled automation",
      description: (input.description ?? "").trim(),
      timezone: definition.trigger.timezone || input.accountTimezone || "Asia/Kolkata",
      templateId: input.templateId ?? definition.metadata?.templateId ?? null,
      definition,
      triggerDenorm: denorm,
    });
    return { id: automation.id, status: automation.status as AutomationStatus, version: version.version };
  },

  async update(userId: string, id: string, patch: UpdateInput): Promise<{ id: string; version: number }> {
    const automation = await this.requireOwned(userId, id);
    if (automation.status === "ARCHIVED") throw new AutomationStateError("ARCHIVED", "edit");

    let newVersion: number | null = null;
    if (patch.definition !== undefined) {
      const definition = validateOrThrow(patch.definition);
      const denorm = triggerDenormFromDefinition(definition);
      const { version } = await automationRepository.addVersion({
        automationId: id,
        createdBy: userId,
        definition,
        triggerDenorm: denorm,
      });
      newVersion = version.version;
      // recompute nextRunAt against the new definition if scheduling
      if (automation.status === "ACTIVE") {
        await automationRepository.patchAutomation(id, {
          nextRunAt: computeNextRunAt(definition, new Date()),
        });
      }
    }

    if (patch.name !== undefined || patch.description !== undefined) {
      await automationRepository.patchAutomation(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() || "Untitled automation" } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      });
    }

    const active = await automationRepository.getVersion(automation.activeVersionId ?? "");
    return { id, version: newVersion ?? active?.version ?? 1 };
  },

  async transition(
    userId: string,
    id: string,
    action: "activate" | "pause" | "resume" | "archive",
  ): Promise<{ status: AutomationStatus; nextRunAt: string | null }> {
    const automation = await this.requireOwned(userId, id);
    const from = automation.status as AutomationStatus;
    const to = ALLOWED[from][action];
    if (!to) throw new AutomationStateError(from, action);

    let nextRunAt: Date | null = null;
    if (to === "ACTIVE") {
      // re-validate the active version before (re)activating
      const version = await automationRepository.getVersion(automation.activeVersionId ?? "");
      if (!version) throw new AutomationValidationError([{ path: "$", message: "no active definition version" }]);
      const check = validateWorkflowDefinition(version.definition);
      if (!check.ok) throw new AutomationValidationError(check.issues);
      nextRunAt = computeNextRunAt(version.definition as unknown as AutomationWorkflowDefinition, new Date());
    }

    await automationRepository.patchAutomation(id, {
      status: to,
      nextRunAt: to === "ACTIVE" ? nextRunAt : to === "PAUSED" ? undefined : null,
    });
    return { status: to, nextRunAt: nextRunAt ? nextRunAt.toISOString() : null };
  },

  async duplicate(userId: string, id: string): Promise<{ id: string }> {
    const automation = await this.requireOwned(userId, id);
    const version = await automationRepository.getVersion(automation.activeVersionId ?? "");
    if (!version) throw new AutomationNotFoundError();
    const created = await this.create({
      userId,
      name: `${automation.name} (copy)`,
      description: automation.description,
      accountTimezone: automation.timezone,
      definition: version.definition,
      templateId: automation.templateId,
    });
    return { id: created.id };
  },

  async list(userId: string, opts: { includeArchived?: boolean } = {}): Promise<AutomationListItem[]> {
    const rows = await automationRepository.listAutomationsForUser(userId, opts);
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    return Promise.all(
      rows.map(async (row) => {
        const [stats, lastRun] = await Promise.all([
          automationRepository.runStatsSince(row.id, since),
          this.lastRunSummary(row.id, userId),
        ]);
        return toListItem(row, row.activeVersion, stats, lastRun);
      }),
    );
  },

  async detail(userId: string, id: string): Promise<AutomationDetail> {
    const row = await automationRepository.getAutomationForUser(id, userId);
    if (!row) throw new AutomationNotFoundError();
    const version = row.activeVersion;
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const [stats, recentRuns, lastRun] = await Promise.all([
      automationRepository.runStatsSince(id, since),
      automationRepository.listRunsForAutomation(id, userId, 20),
      this.lastRunSummary(id, userId),
    ]);
    const base = toListItem(row, version, stats, lastRun);
    return {
      ...base,
      owner: row.userId,
      definition: (version?.definition ?? { schemaVersion: 1, trigger: { type: "manual", timezone: row.timezone }, steps: [] }) as unknown as AutomationWorkflowDefinition,
      recentRuns: recentRuns.map((r) => runSummary(r, r.steps.length)),
    };
  },

  async lastRunSummary(automationId: string, userId: string): Promise<AutomationRunSummary | null> {
    const runs = await automationRepository.listRunsForAutomation(automationId, userId, 1);
    if (!runs[0]) return null;
    return runSummary(runs[0], runs[0].steps.length);
  },

  async requireOwned(userId: string, id: string): Promise<NonNullable<AutomationRow>> {
    const row = await automationRepository.getAutomationForUser(id, userId);
    if (!row) throw new AutomationNotFoundError();
    return row;
  },
};

// ── mappers ──────────────────────────────────────────────────────────────

function toListItem(
  row: Automation,
  version: AutomationDefinitionVersion | null,
  stats: { runs: number; succeeded: number; failed: number; creditsUsed: number },
  lastRun: AutomationRunSummary | null,
): AutomationListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as AutomationStatus,
    timezone: row.timezone,
    trigger: {
      type: (version?.triggerType ?? "manual") as AutomationListItem["trigger"]["type"],
      slot: version?.slot ?? null,
      daysOfWeek: (version?.daysOfWeek ?? []) as AutomationWeekday[],
      runAt: version?.runAt ? version.runAt.toISOString() : null,
    },
    activeVersion: version?.version ?? null,
    lastRun,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    stats30d: {
      runs: stats.runs,
      succeeded: stats.succeeded,
      failed: stats.failed,
      creditsUsed: round2(stats.creditsUsed),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function runSummary(r: AutomationRun, stepCount: number): AutomationRunSummary {
  return {
    id: r.id,
    status: r.status as AutomationRunSummary["status"],
    trigger: r.trigger as AutomationRunSummary["trigger"],
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    durationMs: r.durationMs ?? null,
    creditsUsed: round2(r.creditsUsed),
    stepCount,
    outputRef: (r.outputRef as AutomationRunSummary["outputRef"]) ?? null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
