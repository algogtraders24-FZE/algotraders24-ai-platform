// services/agent-framework/runtime/agent-runtime.ts
// AT24 Agent Framework - A4. The server-side, resumable Agent Runtime.
//
// LOCKED (owner A4):
//  - server-only (no import path reaches the browser bundle).
//  - resumable tick(): startRun() persists a queued run; each tick() executes
//    ONE bounded slice (plan | one tool call | produce output), persists, and
//    returns. A lost serverless invocation resumes purely from the DB row -
//    a fresh AgentRuntime instance can drive the same runId to completion.
//  - LimitEnforcer runs BEFORE any operation crosses into the tool executor
//    (including the credit pre-check for the tool about to run).
//  - RunTracer records every meaningful transition as a durable AgentStep row;
//    console/logger output is an aid, never the audit trail.
//  - A4 proves the substrate, NOT eight agents. The planner is the minimal
//    deterministic one (planner.ts); the real supervisor/planner is A5.
//
// The AgentDefinition is stashed in AgentRun.metadata.definition at startRun
// so tick() is fully self-contained from the DB (a dedicated AgentVersion
// table is a later step).

import {
  type AgentDefinition,
  type PlannerToolRequest,
  type AgentRunLimits,
  DEFAULT_RUN_LIMITS,
  isTerminalRunStatus,
  isValidRunTransition,
  validateAgentDefinition,
} from "@/types/agent-framework";
import { logger } from "@/services/backend/Logger";
import { toolRegistry } from "../tools/registry-manifest";
import type { ToolRegistry } from "../tools/tool-registry";
import { invokeTool } from "../tools/tool-gateway";
import { isKnownAgentType, autonomyCapForType } from "../agent-type-registry";
import { agentRunRepository, type AgentRunRow } from "./agent-run.repository";
import { RunTracer } from "./run-tracer";
import { checkLimits, validateRunLimits } from "./limit-enforcer";
import { planRun } from "./planner";
import { authorizeToolRequest } from "./authorizer";
import type {
  AgentRunStatus as PrismaAgentRunStatus,
  AgentToolCallStatus as PrismaAgentToolCallStatus,
} from "@/lib/generated/prisma/enums";

const log = logger.child("agent-runtime");

export interface StartRunInput {
  definition: AgentDefinition;
  input: unknown;
  userId: string;
  trigger?: "manual" | "schedule" | "event" | "supervisor";
}

interface ResumeState {
  nextPlanIndex: number;
  retriesUsed: number;
}

function readResumeState(row: AgentRunRow): ResumeState {
  const rs = (row?.resumeState ?? null) as Partial<ResumeState> | null;
  return { nextPlanIndex: rs?.nextPlanIndex ?? 0, retriesUsed: rs?.retriesUsed ?? 0 };
}

/** ToolResultStatus -> AgentToolCallStatus (1:1). */
const TOOL_CALL_STATUS: Record<string, PrismaAgentToolCallStatus> = {
  ok: "ok",
  invalid_input: "invalid_input",
  tool_error: "tool_error",
  tool_timeout: "tool_timeout",
  permission_denied: "permission_denied",
};

/** A non-ok ToolResult.status -> the terminal AgentRunStatus for the run. */
const TOOL_FAILURE_RUN_STATUS: Record<string, PrismaAgentRunStatus> = {
  invalid_input: "tool_error",
  tool_error: "tool_error",
  tool_timeout: "tool_error", // "timeout" run status is reserved for wall-clock breach
  permission_denied: "permission_denied",
};

/** authorization denial reason -> terminal AgentRunStatus. */
const AUTH_DENIAL_RUN_STATUS: Record<string, PrismaAgentRunStatus> = {
  unknown_tool: "tool_error",
  tool_disabled: "tool_error",
  missing_permission: "permission_denied",
  autonomy_floor: "permission_denied",
};
const AUTH_DENIAL_TOOLCALL_STATUS: Record<string, PrismaAgentToolCallStatus> = {
  unknown_tool: "invalid_input",
  tool_disabled: "tool_error",
  missing_permission: "permission_denied",
  autonomy_floor: "permission_denied",
};

export class AgentRuntime {
  private readonly registry: ToolRegistry;

  constructor(deps: { registry?: ToolRegistry } = {}) {
    this.registry = deps.registry ?? toolRegistry;
  }

  /** Snapshot the effective ceilings for a run from framework defaults,
   *  tightened (never loosened) by the agent's creditPolicy. */
  private buildLimits(definition: AgentDefinition): AgentRunLimits {
    const limits: AgentRunLimits = {
      ...DEFAULT_RUN_LIMITS,
      maxCreditCost: Math.min(DEFAULT_RUN_LIMITS.maxCreditCost, definition.creditPolicy.perRunCeiling),
    };
    const check = validateRunLimits(limits);
    if (!check.valid) {
      throw new Error(`invalid run limits: ${check.violations.map((v) => v.message).join("; ")}`);
    }
    return limits;
  }

  private flatEstimate(toolId: string): number {
    const impl = this.registry.get(toolId);
    const cc = impl?.definition.creditCost;
    if (!cc) return 0;
    if (cc.model === "flat") return cc.credits;
    return cc.ceiling;
  }

  /** Create a queued run. Returns its id. No execution happens here. */
  async startRun(input: StartRunInput): Promise<{ runId: string }> {
    const validation = validateAgentDefinition(input.definition, {
      isRegisteredType: isKnownAgentType,
      autonomyCapForType,
    });
    if (!validation.valid) {
      throw new Error(
        `cannot start run: invalid AgentDefinition - ${validation.violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`,
      );
    }

    const limits = this.buildLimits(input.definition);
    const creditsEstimated = input.definition.tools.reduce((sum, b) => sum + this.flatEstimate(b.toolId), 0);

    const run = await agentRunRepository.createRun({
      agentId: input.definition.id,
      agentVersion: input.definition.version,
      userId: input.userId,
      trigger: input.trigger ?? "manual",
      input: input.input,
      limits,
      creditsEstimated,
      // A4: the definition snapshot lives here until an AgentVersion table exists.
      metadata: { definition: input.definition as unknown as Record<string, unknown>, contract: "AF-v1" },
    });

    log.info("run created", { runId: run.id, agentId: run.agentId, userId: run.userId });
    return { runId: run.id };
  }

  /**
   * Execute ONE bounded slice of a run and persist the result. Safe to call
   * repeatedly (idempotent once terminal). This is the resumable unit - a
   * scheduler calls it across serverless invocations; runToCompletion() calls
   * it in a loop for the synchronous case.
   */
  async tick(runId: string): Promise<AgentRunRow> {
    const run = await agentRunRepository.getRun(runId);
    if (!run) throw new Error(`AgentRun "${runId}" not found`);
    if (isTerminalRunStatus(run.status)) return run; // idempotent

    const definition = (run.metadata as { definition?: AgentDefinition })?.definition;
    if (!definition) {
      return this.terminate(runId, run.status, "failed", "no_definition", "run.metadata.definition is missing");
    }

    const tracer = new RunTracer(runId);
    const rs = readResumeState(run);

    // ---- LimitEnforcer: wall-clock / step / tool-call / retry (no next-credit yet)
    const [stepCount, toolCallCount] = await Promise.all([
      agentRunRepository.countSteps(runId),
      agentRunRepository.countToolCalls(runId),
    ]);
    const elapsedMs = run.startedAt ? Date.now() - run.startedAt.getTime() : 0;
    const preBreach = checkLimits({
      limits: run.limits as unknown as AgentRunLimits,
      stepCount,
      toolCallCount,
      elapsedMs,
      creditsConsumed: run.creditsConsumed,
      retriesUsed: rs.retriesUsed,
    });
    if (preBreach.breached) {
      return this.terminate(runId, run.status, preBreach.status, preBreach.limit, preBreach.message, tracer);
    }

    switch (run.status) {
      case "queued":
      case "planning":
        return this.doPlan(run, definition, tracer);
      case "running":
        return this.doRunningSlice(run, definition, tracer, rs, { stepCount, toolCallCount, elapsedMs });
      case "awaiting_approval":
        // A4 has no approval-gated tools. A later approveRun() flips this to
        // "running". Nothing to do this tick.
        log.info("tick on awaiting_approval - no-op (approval API is a later step)", { runId });
        return run;
      default:
        return run;
    }
  }

  /** Drive a run to a terminal state. For the synchronous path only. */
  async runToCompletion(runId: string, opts: { maxTicks?: number } = {}): Promise<AgentRunRow> {
    const maxTicks = opts.maxTicks ?? 50;
    let row = await agentRunRepository.getRun(runId);
    for (let i = 0; i < maxTicks; i++) {
      if (!row || isTerminalRunStatus(row.status)) return row;
      row = await this.tick(runId);
    }
    return row;
  }

  // ------------------------------------------------------------------
  // slices
  // ------------------------------------------------------------------

  private async doPlan(run: NonNullable<AgentRunRow>, definition: AgentDefinition, tracer: RunTracer): Promise<AgentRunRow> {
    const startedAt = new Date();

    // If a plan step already exists (crash between planning->running), reuse it.
    const trace = await agentRunRepository.getRunTrace(run.id);
    const existingPlanStep = trace.steps.find((s) => s.kind === "plan");
    if (existingPlanStep && run.plan) {
      await this.safePatch(run, { status: "running", resumeState: { nextPlanIndex: 0, retriesUsed: 0 } });
      tracer.transition(run.status, "running", "resumed after mid-planning crash");
      return agentRunRepository.getRun(run.id);
    }

    if (run.status === "queued") {
      await this.safePatch(run, { status: "planning", startedAt });
      tracer.transition("queued", "planning");
    }

    const plan = planRun(definition, run.input);
    await tracer.step({
      kind: "plan",
      status: "ok",
      summary: plan.rationale,
      output: { requests: plan.requests },
      startedAt,
    });
    await agentRunRepository.patchRun(run.id, {
      status: "running",
      plan: plan.requests,
      resumeState: { nextPlanIndex: 0, retriesUsed: 0 },
    });
    tracer.transition("planning", "running", `${plan.requests.length} step(s) planned`);
    return agentRunRepository.getRun(run.id);
  }

  private async doRunningSlice(
    run: NonNullable<AgentRunRow>,
    definition: AgentDefinition,
    tracer: RunTracer,
    rs: ResumeState,
    counts: { stepCount: number; toolCallCount: number; elapsedMs: number },
  ): Promise<AgentRunRow> {
    const plan = (run.plan ?? []) as unknown as PlannerToolRequest[];

    // ---- plan exhausted -> synthesise the output ----
    if (rs.nextPlanIndex >= plan.length) {
      const startedAt = new Date();
      const trace = await agentRunRepository.getRunTrace(run.id);
      const output = {
        summary: `agent "${definition.slug}" completed ${trace.toolCalls.length} tool call(s)`,
        agentType: definition.type,
        toolResults: trace.toolCalls.map((tc) => ({ toolId: tc.toolId, status: tc.status })),
        evidenceCount: trace.evidence.length,
        evidenceIds: trace.evidence.map((e) => e.id),
      };
      await tracer.step({ kind: "output", status: "ok", summary: "synthesised evidence-backed output", output, startedAt });
      await agentRunRepository.patchRun(run.id, {
        status: "succeeded",
        output,
        completedAt: new Date(),
        resumeState: null,
      });
      tracer.transition("running", "succeeded", `${trace.evidence.length} evidence row(s)`);
      return agentRunRepository.getRun(run.id);
    }

    const request = plan[rs.nextPlanIndex];
    const startedAt = new Date();
    const estimate = this.flatEstimate(request.toolId);

    // ---- credit pre-check BEFORE the executor ----
    const creditBreach = checkLimits(
      {
        limits: run.limits as unknown as AgentRunLimits,
        stepCount: counts.stepCount,
        toolCallCount: counts.toolCallCount,
        elapsedMs: counts.elapsedMs,
        creditsConsumed: run.creditsConsumed,
        retriesUsed: rs.retriesUsed,
      },
      estimate,
    );
    if (creditBreach.breached) {
      return this.terminate(run.id, run.status, creditBreach.status, creditBreach.limit, creditBreach.message, tracer);
    }

    // ---- authorization (Planner != Registry != Executor) ----
    const auth = authorizeToolRequest(definition, request, this.registry, estimate);
    if (!auth.authorized) {
      const step = await tracer.step({
        kind: "tool_call",
        status: "error",
        summary: `authorization denied: ${auth.reason}`,
        input: { toolId: request.toolId, input: request.input },
        output: { reason: auth.reason, message: auth.message },
        startedAt,
      });
      await agentRunRepository.appendToolCall({
        runId: run.id,
        stepId: step.id,
        toolId: request.toolId,
        toolVersion: "unknown",
        input: request.input,
        status: AUTH_DENIAL_TOOLCALL_STATUS[auth.reason],
        permissionChecked: [],
        creditCost: 0,
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        evidenceIds: [],
      });
      return this.terminate(
        run.id,
        run.status,
        AUTH_DENIAL_RUN_STATUS[auth.reason],
        auth.reason,
        auth.message,
        tracer,
      );
    }

    // ---- execute (one bounded slice = one tool call) ----
    const outcome = await invokeTool({
      registry: this.registry,
      intent: auth.intent,
      permissionPolicy: definition.permissionPolicy,
      autonomyLevel: definition.autonomyLevel,
      context: { userId: run.userId, runId: run.id },
    });

    const step = await tracer.step({
      kind: "tool_call",
      status: outcome.result.status === "ok" ? "ok" : "error",
      summary: `${request.toolId} -> ${outcome.result.status}`,
      input: { toolId: request.toolId, input: auth.intent.input },
      output: {
        status: outcome.result.status,
        errorKind: outcome.result.errorKind,
        durationMs: outcome.result.durationMs,
      },
      startedAt,
      creditsConsumed: outcome.result.creditsConsumed,
    });

    const toolCall = await agentRunRepository.appendToolCall({
      runId: run.id,
      stepId: step.id,
      toolId: auth.intent.toolId,
      toolVersion: auth.intent.toolVersion,
      input: auth.intent.input,
      output: outcome.result.output,
      status: TOOL_CALL_STATUS[outcome.result.status] ?? "tool_error",
      permissionChecked: outcome.permissionChecked,
      creditCost: outcome.result.creditsConsumed,
      startedAt,
      completedAt: new Date(),
      durationMs: outcome.result.durationMs,
      evidenceIds: [],
    });

    // Evidence: the authoritative link is AgentEvidence.toolCallId.
    if (outcome.evidence.length > 0) {
      const evidenceIds = await agentRunRepository.appendEvidence(run.id, step.id, toolCall.id, outcome.evidence);
      await tracer.step({
        kind: "evidence",
        status: "ok",
        summary: `${evidenceIds.length} evidence row(s) from ${request.toolId}`,
        output: { evidenceIds },
        startedAt: new Date(),
      });
    }

    const newCredits = run.creditsConsumed + outcome.result.creditsConsumed;

    if (outcome.result.status !== "ok") {
      await agentRunRepository.patchRun(run.id, { creditsConsumed: newCredits });
      return this.terminate(
        run.id,
        run.status,
        TOOL_FAILURE_RUN_STATUS[outcome.result.status] ?? "tool_error",
        outcome.result.errorKind ?? outcome.result.status,
        `tool ${request.toolId} returned ${outcome.result.status}`,
        tracer,
      );
    }

    // advance one plan step; persist; return (one bounded slice per tick)
    await agentRunRepository.patchRun(run.id, {
      creditsConsumed: newCredits,
      resumeState: { nextPlanIndex: rs.nextPlanIndex + 1, retriesUsed: rs.retriesUsed },
    });
    return agentRunRepository.getRun(run.id);
  }

  // ------------------------------------------------------------------

  private async terminate(
    runId: string,
    fromStatus: string,
    toStatus: PrismaAgentRunStatus,
    errorCode: string,
    errorMessage: string,
    tracer?: RunTracer,
  ): Promise<AgentRunRow> {
    if (!isValidRunTransition(fromStatus as never, toStatus as never) && fromStatus !== toStatus) {
      // Should never happen given the dispatch, but never silently corrupt state.
      log.info("forced terminal transition outside the table", { runId, fromStatus, toStatus });
    }
    await agentRunRepository.patchRun(runId, {
      status: toStatus,
      errorCode,
      errorMessage,
      completedAt: new Date(),
      resumeState: null,
    });
    (tracer ?? new RunTracer(runId)).failure(toStatus, errorCode, errorMessage);
    return agentRunRepository.getRun(runId);
  }

  private async safePatch(run: NonNullable<AgentRunRow>, patch: Parameters<typeof agentRunRepository.patchRun>[1]) {
    if (patch.status && !isValidRunTransition(run.status as never, patch.status as never) && run.status !== patch.status) {
      throw new Error(`illegal run transition ${run.status} -> ${patch.status}`);
    }
    return agentRunRepository.patchRun(run.id, patch);
  }
}

/** Process-wide runtime instance (production registry). */
export const agentRuntime = new AgentRuntime();
