// services/automation/run-view.ts
// AT24 Automation (MVP) - the ownership-scoped read model for a run and a
// run's step list (AUTOMATION_API_CONTRACT.md §3). Failures are never
// omitted from `steps`.

import type {
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationStepRunView,
  AutomationWorkflowDefinition,
  AutomationStep,
} from "@/types/automation";
import { automationRepository } from "./automation-repository";
import { automationService } from "./automation-service";
import { stepLabel } from "./definition";
import { AppError } from "@/services/backend/ErrorHandler";
import { ERROR_CODES } from "@/config/backend.config";

export async function listAutomationRuns(
  userId: string,
  automationId: string,
  limit = 20,
): Promise<AutomationRunSummary[]> {
  // ownership check
  await automationService.requireOwned(userId, automationId);
  const rows = await automationRepository.listRunsForAutomation(automationId, userId, limit);
  return rows.map((r) => ({
    id: r.id,
    status: r.status as AutomationRunSummary["status"],
    trigger: r.trigger as AutomationRunSummary["trigger"],
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    durationMs: r.durationMs ?? null,
    creditsUsed: round2(r.creditsUsed),
    stepCount: r.steps.length,
    outputRef: (r.outputRef as AutomationRunSummary["outputRef"]) ?? null,
  }));
}

export async function getRunDetail(userId: string, runId: string): Promise<AutomationRunDetail> {
  const run = await automationRepository.getRunWithSteps(runId, userId);
  if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, "Automation run not found", 404);

  const def = run.definitionVersion.definition as unknown as AutomationWorkflowDefinition;
  const stepsById = new Map<string, AutomationStep>(def.steps.map((s) => [s.id, s]));

  const steps: AutomationStepRunView[] = run.steps.map((s) => {
    const defStep = stepsById.get(s.stepId);
    return {
      index: s.index,
      stepId: s.stepId,
      kind: s.kind as AutomationStepRunView["kind"],
      status: s.status as AutomationStepRunView["status"],
      label: defStep ? stepLabel(defStep) : s.stepId,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      durationMs: s.durationMs ?? null,
      creditsUsed: round2(s.creditsUsed),
      agentRunId: s.agentRunId ?? null,
      articleId: s.articleId ?? null,
      artifactId: s.artifactId ?? null,
      output: s.output ?? null,
      error: parseError(s.error),
      reason: s.reason ?? null,
    };
  });

  return {
    id: run.id,
    automationId: run.automationId,
    automationName: run.automation.name,
    definitionVersion: run.definitionVersion.version,
    status: run.status as AutomationRunDetail["status"],
    trigger: run.trigger as AutomationRunDetail["trigger"],
    scheduledFor: run.scheduledFor ? run.scheduledFor.toISOString() : null,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    durationMs: run.durationMs ?? null,
    creditsUsed: round2(run.creditsUsed),
    steps,
    error: parseRunError(run.error),
    contextSnapshot: run.contextSnapshot ?? null,
  };
}

function parseError(v: unknown): { code: string; message: string } | null {
  if (v && typeof v === "object" && "message" in v) {
    const o = v as Record<string, unknown>;
    return { code: String(o.code ?? "STEP_ERROR"), message: String(o.message ?? "") };
  }
  return null;
}

function parseRunError(v: unknown): { code: string; message: string; failedStepId?: string } | null {
  const base = parseError(v);
  if (!base) return null;
  const o = v as Record<string, unknown>;
  return o.failedStepId ? { ...base, failedStepId: String(o.failedStepId) } : base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
