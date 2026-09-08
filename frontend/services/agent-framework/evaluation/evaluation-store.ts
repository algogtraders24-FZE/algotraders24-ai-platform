// services/agent-framework/evaluation/evaluation-store.ts
// AT24 Agent Framework - A10. Persistence PORT for AgentEvaluation. Two
// impls: PrismaEvaluationStore (the real table) and InMemoryEvaluationStore.

import type { AgentEvaluationResult } from "@/types/agent-framework";

export interface EvaluationStore {
  /** Create one evaluation. If runId already has one, return the existing
   *  (evaluation is once-per-run). */
  upsert(result: AgentEvaluationResult): Promise<AgentEvaluationResult>;
  getByRunId(runId: string): Promise<AgentEvaluationResult | null>;
  clearForUser(userId: string): Promise<number>;
}

export class InMemoryEvaluationStore implements EvaluationStore {
  private rows = new Map<string, AgentEvaluationResult>();

  async upsert(result: AgentEvaluationResult): Promise<AgentEvaluationResult> {
    if (this.rows.has(result.runId)) return this.rows.get(result.runId)!;
    this.rows.set(result.runId, { ...result });
    return { ...result };
  }
  async getByRunId(runId: string): Promise<AgentEvaluationResult | null> {
    return this.rows.get(runId) ?? null;
  }
  async clearForUser(userId: string): Promise<number> {
    let n = 0;
    for (const [k, v] of this.rows) if (v.userId === userId) { this.rows.delete(k); n++; }
    return n;
  }
}
