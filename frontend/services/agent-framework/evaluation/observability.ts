// services/agent-framework/evaluation/observability.ts
// AT24 Agent Framework - A10. The single assembled read model for one run:
//   Run -> Steps -> ToolCalls -> Evidence -> Output -> Integrity ->
//   Evaluation -> Observability
//
// This is what a future GET /runs/:id/observability route (or a dashboard)
// would return. Pure read - never mutates. No API route is added in A10.

import { agentRunRepository } from "../runtime/agent-run.repository";
import { CreditLedger } from "../credits/credit-ledger";
import { createCreditLedger } from "../credits/index";
import { EvaluationService } from "./evaluation-service";
import type { AgentEvaluationResult } from "@/types/agent-framework";

export interface RunObservability {
  run: Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>["run"];
  steps: Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>["steps"];
  toolCalls: Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>["toolCalls"];
  evidence: Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>["evidence"];
  credits: {
    entries: { kind: string; amount: number; reason: string; toolCallId: string | null; createdAt: string }[];
    totalCharged: number;
  };
  evaluation: AgentEvaluationResult | null;
  /** a compact timeline: [{ index, kind, status, summary, ms }] */
  timeline: { index: number; kind: string; status: string; summary: string; durationMs: number }[];
}

export async function getRunObservability(
  runId: string,
  deps: { creditLedger?: CreditLedger; evaluation?: EvaluationService } = {},
): Promise<RunObservability | null> {
  const trace = await agentRunRepository.getRunTrace(runId);
  if (!trace.run) return null;

  const ledger = deps.creditLedger ?? createCreditLedger();
  const evaluator = deps.evaluation ?? new EvaluationService();

  const entries = await ledger.historyForRun(runId).catch(() => []);
  const evaluation = await evaluator.getForRun(runId).catch(() => null);

  return {
    run: trace.run,
    steps: trace.steps,
    toolCalls: trace.toolCalls,
    evidence: trace.evidence,
    credits: {
      entries: entries.map((e) => ({ kind: e.kind, amount: e.amount, reason: e.reason, toolCallId: e.toolCallId ?? null, createdAt: e.createdAt })),
      totalCharged: entries.reduce((s, e) => s + e.amount, 0),
    },
    evaluation,
    timeline: trace.steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      status: s.status,
      summary: s.summary,
      durationMs: s.durationMs,
    })),
  };
}
