// services/agent-framework/runtime/agent-run.repository.ts
// AT24 Agent Framework - A4. The ONLY module that reads/writes the A3
// AgentRun / AgentStep / AgentToolCall / AgentEvidence tables. Server-only.
//
// LOCKED (AN1.2 invariant 2): AgentStep / AgentToolCall / AgentEvidence are
// append-only - this repository exposes `append*` methods only, never
// `updateStep` / `deleteStep`. AgentRun has a narrow `patchRun` for its
// status + terminal fields + resumeState.
//
// The database is the durable execution ledger. A lost serverless
// invocation resumes purely from these rows (see AgentRuntime.tick).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  AgentRunStatus,
  AgentRunTrigger,
  AgentStepKind,
  AgentStepStatus,
  AgentToolCallStatus,
  AgentEvidenceType,
} from "@/lib/generated/prisma/enums";
import type { AgentEvidenceDraft } from "@/types/agent-framework";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

export interface CreateRunInput {
  agentId: string;
  agentVersion: string;
  userId: string;
  trigger: AgentRunTrigger;
  input: unknown;
  limits: unknown;
  creditsEstimated: number;
  metadata: Record<string, unknown>;
}

export interface AppendStepInput {
  runId: string;
  index: number;
  kind: AgentStepKind;
  status: AgentStepStatus;
  summary: string;
  input?: unknown;
  output?: unknown;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  creditsConsumed: number;
}

export interface AppendToolCallInput {
  runId: string;
  stepId: string;
  toolId: string;
  toolVersion: string;
  input: unknown;
  output?: unknown;
  status: AgentToolCallStatus;
  permissionChecked: string[];
  creditCost: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  evidenceIds: string[];
}

export interface PatchRunInput {
  status?: AgentRunStatus;
  plan?: unknown;
  output?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  creditsConsumed?: number;
  startedAt?: Date;
  completedAt?: Date;
  resumeState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export const agentRunRepository = {
  async createRun(data: CreateRunInput) {
    return prisma.agentRun.create({
      data: {
        agentId: data.agentId,
        agentVersion: data.agentVersion,
        userId: data.userId,
        status: "queued",
        trigger: data.trigger,
        input: asJson(data.input),
        limits: asJson(data.limits),
        creditsEstimated: data.creditsEstimated,
        metadata: asJson(data.metadata),
      },
    });
  },

  async getRun(runId: string) {
    return prisma.agentRun.findUnique({ where: { id: runId } });
  },

  /** Full forensic trace: run + ordered steps + tool calls + evidence. */
  async getRunTrace(runId: string) {
    const [run, steps, toolCalls, evidence] = await Promise.all([
      prisma.agentRun.findUnique({ where: { id: runId } }),
      prisma.agentStep.findMany({ where: { runId }, orderBy: { index: "asc" } }),
      prisma.agentToolCall.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      prisma.agentEvidence.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    ]);
    return { run, steps, toolCalls, evidence };
  },

  async countSteps(runId: string): Promise<number> {
    return prisma.agentStep.count({ where: { runId } });
  },

  async countToolCalls(runId: string): Promise<number> {
    return prisma.agentToolCall.count({ where: { runId } });
  },

  async nextStepIndex(runId: string): Promise<number> {
    const last = await prisma.agentStep.findFirst({
      where: { runId },
      orderBy: { index: "desc" },
      select: { index: true },
    });
    return last ? last.index + 1 : 0;
  },

  /** Append one immutable step. The unique (runId, index) constraint makes a
   *  double-write at the same position fail loudly rather than corrupt the
   *  ordered history. */
  async appendStep(data: AppendStepInput) {
    return prisma.agentStep.create({
      data: {
        runId: data.runId,
        index: data.index,
        kind: data.kind,
        status: data.status,
        summary: data.summary,
        input: data.input === undefined ? undefined : asJson(data.input),
        output: data.output === undefined ? undefined : asJson(data.output),
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        durationMs: data.durationMs,
        creditsConsumed: data.creditsConsumed,
      },
    });
  },

  async appendToolCall(data: AppendToolCallInput) {
    return prisma.agentToolCall.create({
      data: {
        runId: data.runId,
        stepId: data.stepId,
        toolId: data.toolId,
        toolVersion: data.toolVersion,
        input: asJson(data.input),
        output: data.output === undefined ? undefined : asJson(data.output),
        status: data.status,
        permissionChecked: data.permissionChecked,
        creditCost: data.creditCost,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        durationMs: data.durationMs,
        evidenceIds: data.evidenceIds,
      },
    });
  },

  /** Persist evidence drafts produced by a tool call, assigning run/step/
   *  toolCall linkage. Returns the created row ids (for AgentToolCall.evidenceIds). */
  async appendEvidence(
    runId: string,
    stepId: string,
    toolCallId: string | null,
    drafts: AgentEvidenceDraft[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const d of drafts) {
      const row = await prisma.agentEvidence.create({
        data: {
          runId,
          stepId,
          toolCallId: toolCallId ?? undefined,
          type: d.type as AgentEvidenceType,
          claim: d.claim,
          source: d.source,
          sourceId: d.sourceId,
          timestamp: new Date(d.timestamp),
          data: asJson(d.data),
          relevance: d.relevance,
          confidence: d.confidence,
          provenance: asJson(d.provenance),
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  },

  async patchRun(runId: string, patch: PatchRunInput) {
    return prisma.agentRun.update({
      where: { id: runId },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.plan !== undefined ? { plan: asJson(patch.plan) } : {}),
        ...(patch.output !== undefined ? { output: asJson(patch.output) } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.creditsConsumed !== undefined ? { creditsConsumed: patch.creditsConsumed } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.metadata !== undefined ? { metadata: asJson(patch.metadata) } : {}),
        ...(patch.resumeState !== undefined
          ? { resumeState: patch.resumeState === null ? Prisma.DbNull : asJson(patch.resumeState) }
          : {}),
      },
    });
  },

  /** Test-only helper: remove every run (and its cascaded subtree) for a
   *  synthetic test user. Never called from production paths. */
  async _deleteRunsForUser(userId: string): Promise<number> {
    const res = await prisma.agentRun.deleteMany({ where: { userId } });
    return res.count;
  },
};

export type AgentRunRow = Awaited<ReturnType<typeof agentRunRepository.getRun>>;
