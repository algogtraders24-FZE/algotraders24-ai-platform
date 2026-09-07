// services/agent-framework/evaluation/prisma-evaluation-store.ts
// AT24 Agent Framework - A10. The real EvaluationStore. Functional once the
// A10 migration (20260907130000_add_agent_evaluation) is applied.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { EvaluationStore } from "./evaluation-store";
import type { AgentEvaluationResult, AgentEvaluationScore, RunFailureCategory, AgentRunStatus } from "@/types/agent-framework";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

type Row = {
  runId: string; agentId: string; userId: string; terminalStatus: string;
  scores: unknown; compositeScore: number; failureCategory: string; failureAnalysis: string;
  measurableSignals: unknown; evaluatorVersion: string; createdAt: Date;
};

function toResult(r: Row): AgentEvaluationResult {
  return {
    runId: r.runId, agentId: r.agentId, userId: r.userId,
    terminalStatus: r.terminalStatus as AgentRunStatus,
    scores: (r.scores ?? []) as AgentEvaluationScore[],
    compositeScore: r.compositeScore,
    failureCategory: r.failureCategory as RunFailureCategory,
    failureAnalysis: r.failureAnalysis,
    measurableSignals: (r.measurableSignals ?? {}) as Record<string, number | string | boolean>,
    evaluatorVersion: r.evaluatorVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

export class PrismaEvaluationStore implements EvaluationStore {
  async upsert(result: AgentEvaluationResult): Promise<AgentEvaluationResult> {
    try {
      const row = await prisma.agentEvaluation.create({
        data: {
          runId: result.runId,
          agentId: result.agentId,
          userId: result.userId,
          terminalStatus: result.terminalStatus,
          scores: asJson(result.scores),
          compositeScore: result.compositeScore,
          failureCategory: result.failureCategory,
          failureAnalysis: result.failureAnalysis,
          measurableSignals: asJson(result.measurableSignals),
          evaluatorVersion: result.evaluatorVersion,
        },
      });
      return toResult(row as unknown as Row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.agentEvaluation.findUnique({ where: { runId: result.runId } });
        if (existing) return toResult(existing as unknown as Row);
      }
      throw err;
    }
  }

  async getByRunId(runId: string): Promise<AgentEvaluationResult | null> {
    const r = await prisma.agentEvaluation.findUnique({ where: { runId } });
    return r ? toResult(r as unknown as Row) : null;
  }

  async clearForUser(userId: string): Promise<number> {
    const res = await prisma.agentEvaluation.deleteMany({ where: { userId } });
    return res.count;
  }
}
