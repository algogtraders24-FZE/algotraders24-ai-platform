// services/automation/dispatcher.ts
// AT24 Automation (MVP) - the executor. Walks a run's versioned step list,
// delegating the real work to the Agent Framework (agent_run), Publishing
// (publication_draft) and the artifact sink (workspace_save). Condition steps
// are evaluated in-process.
//
// LOCKED (AUTOMATION_EXECUTION_CONTRACT.md):
//  - Automation NEVER charges credits or writes AgentRun rows itself - a
//    child AgentRun does, through the existing ledger. creditsUsed here is a
//    denormalised copy of obs.credits.totalCharged.
//  - Steps run strictly in order. A false condition -> CONDITION_HALTED
//    (a neutral stop). A step error -> FAILED. Downstream steps -> SKIPPED.
//    Failures are never hidden.
//  - The whole function is a pure function of persisted state: a lost
//    serverless invocation resumes from AutomationStepRun rows + child
//    AgentRun status. Bounded by AUTOMATION_MAX_AGENT_ADVANCES per child run
//    and by the caller's wall-clock budget.

import { logger } from "@/services/backend/Logger";
import { articleService } from "@/services/publishing/article.service";
import type { ContentCategory } from "@/types/content-category";
import {
  startAgentRun,
  advanceAgentRun,
  getAgentRun,
} from "@/services/agent-framework/api/agent-run-service";
import type {
  AutomationWorkflowDefinition,
  AutomationStep,
  AutomationRunStatus,
} from "@/types/automation";
import { automationRepository } from "./automation-repository";
import { artifactSink } from "./artifact-sink";
import { evaluateCondition } from "./condition-eval";
import { emptyRunContext, resolveContextPath, type AutomationRunContext } from "./context-path";
import { computeNextRunAt } from "./scheduler";

const log = logger.child("automation-dispatch");

/** Max child-run advance ticks per agent_run step within one dispatch call.
 *  A child that does not finish leaves the automation run RUNNING for the
 *  catch-up pass / client advance to resume. */
const MAX_AGENT_ADVANCES = 40;

interface StepError {
  code: string;
  message: string;
}

/**
 * Drive one AutomationRun to a terminal state (or leave it RUNNING if a
 * child agent run did not finish within the tick budget). Idempotent once
 * terminal.
 */
export async function dispatchAutomationRun(automationRunId: string): Promise<void> {
  const run = await automationRepository.getRun(automationRunId);
  if (!run) throw new Error(`AutomationRun "${automationRunId}" not found`);
  if (isTerminal(run.status as AutomationRunStatus)) return;

  const automation = await automationRepository.getAutomationForUser(run.automationId, run.userId);
  const version = await automationRepository.getVersion(run.definitionVersionId);
  if (!automation || !version) {
    await finalize(automationRunId, "FAILED", { code: "NO_DEFINITION", message: "automation or definition version missing" });
    return;
  }
  const def = version.definition as unknown as AutomationWorkflowDefinition;

  // claim QUEUED -> RUNNING (loses the race harmlessly)
  if (run.status === "QUEUED") {
    const claimed = await automationRepository.claimQueuedRun(automationRunId);
    if (!claimed) {
      const fresh = await automationRepository.getRun(automationRunId);
      if (fresh && isTerminal(fresh.status as AutomationRunStatus)) return;
    }
  }

  // rebuild the run context from persisted step outputs (resume-safe)
  const existing = await automationRepository.stepRunsForRun(automationRunId);
  const ctx = rebuildContext(run, existing);

  let totalCredits = existing.reduce((sum, s) => sum + (s.creditsUsed ?? 0), 0);
  let lastOutputRef: { kind: string; ids: Record<string, string> } | null =
    (run.outputRef as { kind: string; ids: Record<string, string> } | null) ?? null;

  for (let index = 0; index < def.steps.length; index++) {
    const step = def.steps[index];
    const prior = existing.find((s) => s.index === index);

    // already completed on a previous invocation
    if (prior && (prior.status === "OK" || prior.status === "SKIPPED")) continue;
    if (prior && prior.status === "FAILED") {
      // a previous invocation already failed this step - run is terminal-failed
      await finalize(automationRunId, "FAILED", asError(prior.error), totalCredits, lastOutputRef, ctx);
      return;
    }

    // cancellation check between steps
    const cancelCheck = await automationRepository.getRun(automationRunId);
    if (cancelCheck?.cancelRequestedAt) {
      if (!prior) await automationRepository.appendStepRun({ automationRunId, stepId: step.id, index, kind: step.kind });
      await skipRemaining(automationRunId, def.steps, index, existing, "run cancelled by owner");
      await finalize(automationRunId, "CANCELLED", null, totalCredits, lastOutputRef, ctx);
      return;
    }

    const stepRun = prior ?? (await automationRepository.appendStepRun({ automationRunId, stepId: step.id, index, kind: step.kind }));
    const stepStart = Date.now();
    await automationRepository.patchStepRun(stepRun.id, { status: "RUNNING", startedAt: new Date(stepStart) });

    try {
      const result = await executeStep(step, {
        automationRunId,
        stepRunId: stepRun.id,
        userId: run.userId,
        ctx,
      });

      if (result.kind === "condition_halt") {
        await automationRepository.patchStepRun(stepRun.id, {
          status: "OK",
          output: result.output,
          completedAt: new Date(),
          durationMs: Date.now() - stepStart,
        });
        await skipRemaining(automationRunId, def.steps, index + 1, existing, `condition ${step.id} halted the run`);
        await finalize(automationRunId, "CONDITION_HALTED", null, totalCredits, lastOutputRef, ctx);
        return;
      }

      if (result.kind === "incomplete") {
        // a child agent run did not finish within the tick budget - leave the
        // automation run RUNNING for the next pass to resume this same step.
        await automationRepository.patchStepRun(stepRun.id, { status: "RUNNING" });
        return;
      }

      totalCredits += result.creditsUsed ?? 0;
      if (result.contextPatch) ctx.steps[step.id] = { ...(ctx.steps[step.id] ?? {}), ...result.contextPatch };
      if (result.outputRef) lastOutputRef = result.outputRef;

      await automationRepository.patchStepRun(stepRun.id, {
        status: "OK",
        output: result.output ?? null,
        agentRunId: result.agentRunId ?? null,
        articleId: result.articleId ?? null,
        artifactId: result.artifactId ?? null,
        creditsUsed: result.creditsUsed ?? 0,
        completedAt: new Date(),
        durationMs: Date.now() - stepStart,
      });
    } catch (err) {
      const e = toStepError(err);
      const runStatus: AutomationRunStatus = e.code === "CREDIT_LIMIT" ? "CREDIT_BLOCKED" : "FAILED";
      await automationRepository.patchStepRun(stepRun.id, {
        status: "FAILED",
        error: e,
        completedAt: new Date(),
        durationMs: Date.now() - stepStart,
        creditsUsed: (err as { creditsUsed?: number })?.creditsUsed ?? 0,
      });
      totalCredits += (err as { creditsUsed?: number })?.creditsUsed ?? 0;
      await skipRemaining(automationRunId, def.steps, index + 1, existing, `prior step ${step.id} failed`);
      await finalize(automationRunId, runStatus, { ...e, failedStepId: step.id }, totalCredits, lastOutputRef, ctx);
      return;
    }
  }

  await finalize(automationRunId, "SUCCEEDED", null, totalCredits, lastOutputRef, ctx);
}

// ── step execution ───────────────────────────────────────────────────────

interface StepExecCtx {
  automationRunId: string;
  stepRunId: string;
  userId: string;
  ctx: AutomationRunContext;
}

type StepExecResult =
  | { kind: "ok"; output?: unknown; contextPatch?: Record<string, unknown>; creditsUsed?: number; agentRunId?: string; articleId?: string; artifactId?: string; outputRef?: { kind: string; ids: Record<string, string> } }
  | { kind: "condition_halt"; output: unknown }
  | { kind: "incomplete" };

async function executeStep(step: AutomationStep, x: StepExecCtx): Promise<StepExecResult> {
  switch (step.kind) {
    case "condition": {
      const r = evaluateCondition(step.condition, x.ctx);
      const output = { left: r.left, op: r.op, right: r.right, result: r.result, note: r.note };
      x.ctx.steps[step.id] = { result: r.result };
      return r.result ? { kind: "ok", output } : { kind: "condition_halt", output };
    }

    case "agent_run": {
      const { runId } = await startAgentRun({
        userId: x.userId,
        agentType: step.action.agentType,
        goal: step.action.input,
        trigger: "schedule",
      });

      let terminal = false;
      for (let i = 0; i < MAX_AGENT_ADVANCES && !terminal; i++) {
        const res = await advanceAgentRun(x.userId, runId);
        if (!res) break;
        terminal = res.terminal;
      }
      if (!terminal) {
        // record the child run id so a resume can pick it up, then yield
        await automationRepository.patchStepRun(x.stepRunId, { agentRunId: runId });
        return { kind: "incomplete" };
      }

      const obs = await getAgentRun(x.userId, runId);
      const status = obs?.run?.status ?? "failed";
      const creditsUsed = obs?.credits.totalCharged ?? obs?.run?.creditsConsumed ?? 0;

      if (status !== "succeeded") {
        const err = new Error(
          status === "credit_limit"
            ? "insufficient credits for the agent run"
            : `agent run ended ${status}${obs?.run?.errorMessage ? `: ${obs.run.errorMessage}` : ""}`,
        ) as Error & { code?: string; creditsUsed?: number };
        err.code = status === "credit_limit" ? "CREDIT_LIMIT" : "AGENT_RUN_FAILED";
        err.creditsUsed = creditsUsed;
        throw err;
      }

      const rawOutput = (obs?.run?.output ?? {}) as Record<string, unknown>;
      const contextPatch: Record<string, unknown> = { result: rawOutput, ...flattenTopLevel(rawOutput) };
      if (step.outputBindings) {
        for (const [key, path] of Object.entries(step.outputBindings)) {
          // outputBindings paths address THIS step's raw output as `$.result.*`
          const localCtx = emptyRunContext();
          localCtx.steps[step.id] = { result: rawOutput, ...flattenTopLevel(rawOutput) };
          contextPatch[key] = resolveContextPath(path.replace(/^\$\./, `$.steps.${step.id}.`), localCtx);
        }
      }
      return {
        kind: "ok",
        output: { agentRunId: runId, status },
        contextPatch,
        creditsUsed,
        agentRunId: runId,
        outputRef: { kind: "agent_run", ids: { agentRunId: runId } },
      };
    }

    case "publication_draft": {
      const keywords = step.action.keywords
        ?? asStringArray(resolveContextPath(step.action.keywordsFrom ?? "", x.ctx))
        ?? [];
      const overviewRaw = step.action.aiOverviewFrom ? resolveContextPath(step.action.aiOverviewFrom, x.ctx) : undefined;
      const aiOverviewText = typeof overviewRaw === "string" && overviewRaw.trim().length >= 40 ? overviewRaw : undefined;

      const article = await articleService.createDraft(x.userId, {
        category: step.action.category as ContentCategory,
        keywords: keywords.length ? keywords : ["market", "analysis"],
        aiOverviewText,
      });
      x.ctx.steps[step.id] = { articleId: article.id };
      return {
        kind: "ok",
        output: { articleId: article.id, status: article.status },
        articleId: article.id,
        outputRef: { kind: "publication_draft", ids: { articleId: article.id } },
      };
    }

    case "workspace_save": {
      const payload = resolveContextPath(step.action.from, x.ctx) ?? null;
      const { artifactId } = await artifactSink.save({
        userId: x.userId,
        automationRunId: x.automationRunId,
        stepRunId: x.stepRunId,
        title: step.action.title,
        kind: "agent_result",
        payload,
      });
      x.ctx.steps[step.id] = { artifactId };
      return {
        kind: "ok",
        output: { artifactId },
        artifactId,
        outputRef: { kind: "workspace_save", ids: { artifactId } },
      };
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function isTerminal(s: AutomationRunStatus): boolean {
  return s === "SUCCEEDED" || s === "FAILED" || s === "CONDITION_HALTED" || s === "CANCELLED" || s === "CREDIT_BLOCKED";
}

function rebuildContext(
  run: NonNullable<Awaited<ReturnType<typeof automationRepository.getRun>>>,
  steps: Awaited<ReturnType<typeof automationRepository.stepRunsForRun>>,
): AutomationRunContext {
  const ctx = emptyRunContext(
    {
      type: "schedule",
      firedAt: (run.startedAt ?? run.createdAt).toISOString(),
      scheduledFor: run.scheduledFor ? run.scheduledFor.toISOString() : null,
    },
    {},
  );
  for (const s of steps) {
    if (s.status !== "OK") continue;
    const out = (s.output ?? {}) as Record<string, unknown>;
    ctx.steps[s.stepId] = { ...out };
  }
  return ctx;
}

async function skipRemaining(
  automationRunId: string,
  steps: AutomationStep[],
  fromIndex: number,
  existing: Awaited<ReturnType<typeof automationRepository.stepRunsForRun>>,
  reason: string,
): Promise<void> {
  for (let i = fromIndex; i < steps.length; i++) {
    const prior = existing.find((s) => s.index === i);
    const row = prior ?? (await automationRepository.appendStepRun({
      automationRunId,
      stepId: steps[i].id,
      index: i,
      kind: steps[i].kind,
    }));
    if (row.status === "OK" || row.status === "FAILED") continue;
    await automationRepository.patchStepRun(row.id, { status: "SKIPPED", reason, completedAt: new Date() });
  }
}

async function finalize(
  automationRunId: string,
  status: AutomationRunStatus,
  error: (StepError & { failedStepId?: string }) | null,
  creditsUsed = 0,
  outputRef: { kind: string; ids: Record<string, string> } | null = null,
  ctx?: AutomationRunContext,
): Promise<void> {
  const run = await automationRepository.getRun(automationRunId);
  if (!run) return;
  const startedAtMs = run.startedAt ? run.startedAt.getTime() : run.createdAt.getTime();
  const completedAt = new Date();
  await automationRepository.patchRun(automationRunId, {
    status,
    completedAt,
    durationMs: completedAt.getTime() - startedAtMs,
    creditsUsed: Math.round(creditsUsed * 100) / 100,
    error: error ?? null,
    outputRef: outputRef ?? undefined,
    contextSnapshot: ctx ? { trigger: ctx.trigger, steps: ctx.steps } : undefined,
  });

  // best-effort: advance the parent automation's lastRunAt / nextRunAt
  try {
    const automation = await automationRepository.getAutomationForUser(run.automationId, run.userId);
    const version = automation?.activeVersion;
    if (automation && version) {
      const def = version.definition as unknown as AutomationWorkflowDefinition;
      const onceAlreadyRan = def.trigger.type === "once";
      await automationRepository.patchAutomation(automation.id, {
        lastRunAt: completedAt,
        nextRunAt:
          automation.status === "ACTIVE" ? computeNextRunAt(def, completedAt, { onceAlreadyRan }) : undefined,
        ...(def.trigger.type === "once" && automation.status === "ACTIVE" ? { status: "ARCHIVED" } : {}),
      });
    }
  } catch (err) {
    log.warn("post-run automation bookkeeping failed", { automationRunId, err: String(err) });
  }
}

function asError(v: unknown): StepError | null {
  if (v && typeof v === "object" && "message" in v) {
    const o = v as Record<string, unknown>;
    return { code: String(o.code ?? "STEP_FAILED"), message: String(o.message ?? "step failed") };
  }
  return null;
}

function toStepError(err: unknown): StepError {
  if (err && typeof err === "object") {
    const o = err as { code?: string; message?: string };
    return { code: o.code ?? "STEP_ERROR", message: o.message ?? "step failed" };
  }
  return { code: "STEP_ERROR", message: String(err) };
}

function flattenTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function asStringArray(v: unknown): string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return null;
}
