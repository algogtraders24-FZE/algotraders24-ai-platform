// services/agent-framework/evaluation/index.ts
// AT24 Agent Framework - A10 evaluation + observability. Server-only.

export { EvaluationService, evaluationService, EVALUATOR_VERSION } from "./evaluation-service";
export type { EvaluationDeps } from "./evaluation-service";
export { getRunObservability } from "./observability";
export type { RunObservability } from "./observability";
export type { EvaluationStore } from "./evaluation-store";
export { InMemoryEvaluationStore } from "./evaluation-store";
export { PrismaEvaluationStore } from "./prisma-evaluation-store";

import { EvaluationStore } from "./evaluation-store";
import { InMemoryEvaluationStore } from "./evaluation-store";
import { PrismaEvaluationStore } from "./prisma-evaluation-store";

/** The store the runtime's default EvaluationService uses. Env escape hatch
 *  (AGENT_CREDIT_INMEMORY=1, shared with the ledger) keeps validation
 *  harnesses off the real table before the A10 migration is applied. */
export function defaultEvaluationStore(): EvaluationStore {
  if (process.env.AGENT_CREDIT_INMEMORY === "1") return new InMemoryEvaluationStore();
  return new PrismaEvaluationStore();
}
