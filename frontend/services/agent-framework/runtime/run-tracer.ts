// services/agent-framework/runtime/run-tracer.ts
// AT24 Agent Framework - A4. The RunTracer records every meaningful runtime
// transition as DURABLE STATE (an AgentStep row), and mirrors it to the
// structured logger with a runId correlation id.
//
// LOCKED (owner A4 rule): the audit trail is the database, NOT console.log.
// logger.info here is an operational aid only; every claim it makes is also
// a persisted row.

import { logger } from "@/services/backend/Logger";
import type {
  AgentStepKind,
  AgentStepStatus,
} from "@/lib/generated/prisma/enums";
import { agentRunRepository } from "./agent-run.repository";

const log = logger.child("agent-runtime");

export interface TraceStepInput {
  runId: string;
  kind: AgentStepKind;
  status: AgentStepStatus;
  summary: string;
  input?: unknown;
  output?: unknown;
  startedAt: Date;
  creditsConsumed?: number;
}

export class RunTracer {
  constructor(private readonly runId: string) {}

  /** Append one immutable step at the next index and log it. Returns the
   *  created step row (its id is needed to link tool calls / evidence). */
  async step(input: Omit<TraceStepInput, "runId">) {
    const completedAt = new Date();
    const index = await agentRunRepository.nextStepIndex(this.runId);
    const row = await agentRunRepository.appendStep({
      runId: this.runId,
      index,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      input: input.input,
      output: input.output,
      startedAt: input.startedAt,
      completedAt,
      durationMs: completedAt.getTime() - input.startedAt.getTime(),
      creditsConsumed: input.creditsConsumed ?? 0,
    });
    log.info("step", {
      runId: this.runId,
      stepId: row.id,
      index,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
    });
    return row;
  }

  transition(from: string, to: string, reason?: string): void {
    log.info("run transition", { runId: this.runId, from, to, reason });
  }

  failure(status: string, code: string, message: string): void {
    log.info("run failure", { runId: this.runId, status, code, message });
  }
}
