// services/agent-framework/evaluation/evaluation-service.ts
// AT24 Agent Framework - A10. The heuristic run evaluator.
//
// LOCKED (owner G09): A10 is NOT another authorization or integrity engine.
// It READS the recorded results of A6 (the integrity "evaluation" step),
// A8 (denial steps + the checks each records) and A9 (the credit ledger
// history) from the persisted trace, and SCORES them into a structured,
// auditable AgentEvaluation. Deterministic. No LLM.

import {
  type AgentDefinition,
  type AgentEvaluationResult,
  type AgentEvaluationScore,
  type AgentEvaluationDimension,
  type RunFailureCategory,
  type AgentRunStatus,
} from "@/types/agent-framework";
import { logger } from "@/services/backend/Logger";
import { buildLineage } from "../integrity/evidence-lineage";
import type { ToolRegistry } from "../tools/tool-registry";
import { toolRegistry } from "../tools/registry-manifest";
import { AGENT_TYPE_REGISTRY } from "../agent-type-registry";
import { agentRunRepository } from "../runtime/agent-run.repository";
import { CreditLedger } from "../credits/credit-ledger";
import { createCreditLedger } from "../credits/index";
import {
  type EvaluationStore,
  InMemoryEvaluationStore,
} from "./evaluation-store";

export const EVALUATOR_VERSION = "A10-heuristic-v1";

const log = logger.child("agent-evaluation");

const WEIGHTS: Record<AgentEvaluationDimension, number> = {
  completion: 0.25,
  groundedness: 0.2,
  evidence: 0.15,
  integrity: 0.15,
  tool_selection: 0.1,
  authorization: 0.1,
  limits_respected: 0.05,
};

const RESOURCE_LIMIT_STATUSES = new Set<AgentRunStatus>(["step_limit", "tool_call_limit", "timeout", "credit_limit"]);
const EXPECTED_GUARDRAIL_STATUSES = new Set<AgentRunStatus>(["permission_denied", "credit_limit"]);

export interface EvaluationDeps {
  registry?: ToolRegistry;
  creditLedger?: CreditLedger;
  store?: EvaluationStore;
}

export class EvaluationService {
  private readonly registry: ToolRegistry;
  private readonly ledger: CreditLedger;
  private readonly store: EvaluationStore;

  constructor(deps: EvaluationDeps = {}) {
    this.registry = deps.registry ?? toolRegistry;
    this.ledger = deps.creditLedger ?? createCreditLedger();
    this.store = deps.store ?? new InMemoryEvaluationStore();
  }

  /** Evaluate one terminal run and persist the result (once per run). */
  async evaluate(runId: string): Promise<AgentEvaluationResult | null> {
    const existing = await this.store.getByRunId(runId);
    if (existing) return existing;

    const trace = await agentRunRepository.getRunTrace(runId);
    const run = trace.run;
    if (!run) return null;

    const definition = (run.metadata as { definition?: AgentDefinition } | null)?.definition;
    const planMeta = (run.metadata as { plan?: { specialist?: string; planningPath?: string } } | null)?.plan ?? {};

    const status = run.status as AgentRunStatus;
    const succeeded = status === "succeeded";

    // ---- read A6: the integrity "evaluation" step ----
    const integrityStep = trace.steps.find((s) => s.kind === "evaluation");
    const integrity = integrityStep?.output as { passed?: boolean; violations?: unknown[] } | undefined;
    const integrityPassed = integrity?.passed;
    const integrityViolationCount = Array.isArray(integrity?.violations) ? integrity!.violations!.length : 0;

    // ---- read A8: authorization denial steps ----
    const denialSteps = trace.steps.filter(
      (s) => s.kind === "tool_call" && s.status === "error" &&
        typeof (s.output as { outcome?: string })?.outcome === "string" &&
        (s.output as { outcome?: string }).outcome !== "ok",
    );
    const deniedGateCount = denialSteps.length;

    // ---- read A9: the credit ledger for this run ----
    const ledgerEntries = await this.ledger.historyForRun(runId).catch(() => []);
    const creditsCharged = ledgerEntries.reduce((s, e) => s + e.amount, 0);
    const maxCreditCost = (run.limits as { maxCreditCost?: number } | null)?.maxCreditCost ?? Infinity;

    // ---- lineage (READ A6's helper) ----
    const lineage = buildLineage(run.output, trace, this.registry);

    const output = (run.output ?? {}) as { resolved?: boolean; basis?: unknown[]; evidenceIds?: unknown[]; bias?: string };

    // ================= dimension scores =================
    const scores: AgentEvaluationScore[] = [];
    const add = (dimension: AgentEvaluationDimension, score: number, basis: string) =>
      scores.push({ dimension, score: Math.max(0, Math.min(1, score)), basis });

    // completion
    if (succeeded) add("completion", 1, "run reached 'succeeded'");
    else if (EXPECTED_GUARDRAIL_STATUSES.has(status) && (deniedGateCount > 0 || run.errorCode === "insufficient_credits"))
      add("completion", 0.7, `run stopped at an expected guardrail (${run.errorCode ?? status}) - framework behaved as designed`);
    else if (status === "tool_error")
      add("completion", 0.4, `run failed on a tool error (${run.errorCode ?? "tool_error"})`);
    else add("completion", 0.1, `run ended '${status}' (${run.errorCode ?? "no code"}) - not a clean completion`);

    // tool_selection - executed tools within the type's default set + bound
    const executed = trace.toolCalls.filter((tc) => tc.status === "ok" || tc.status === "tool_error").map((tc) => tc.toolId);
    const boundIds = new Set((definition?.tools ?? []).map((b) => b.toolId));
    const typeDefaults = new Set(
      (definition && AGENT_TYPE_REGISTRY[definition.type as keyof typeof AGENT_TYPE_REGISTRY]?.defaultTools) ?? [],
    );
    if (executed.length === 0) {
      add("tool_selection", succeeded ? 0.6 : 0.4, "no tools executed");
    } else {
      const bound = executed.filter((t) => boundIds.has(t)).length / executed.length;
      const inDefaults = typeDefaults.size ? executed.filter((t) => typeDefaults.has(t)).length / executed.length : bound;
      const overreach = deniedGateCount > 0 ? 0.5 : 1;
      add(
        "tool_selection",
        ((bound + inDefaults) / 2) * overreach,
        `${executed.length} tool(s) executed; ${Math.round(bound * 100)}% bound, ${Math.round(inDefaults * 100)}% in the ${definition?.type ?? "?"} default set${deniedGateCount > 0 ? "; an unauthorized tool was attempted" : ""}`,
      );
    }

    // authorization - did the boundary hold on every executed call
    if (deniedGateCount === 0) add("authorization", 1, "every tool call passed authorization");
    else add("authorization", 0.4, `${deniedGateCount} authorization denial(s) - the guardrail held, but the agent overreached`);

    // evidence
    if (!succeeded && executed.length === 0) add("evidence", 0.5, "run produced no tool calls / evidence (early failure)");
    else if (trace.evidence.length === 0) add("evidence", succeeded ? 0.3 : 0.4, "no evidence rows captured");
    else if (!lineage.complete) add("evidence", 0.3, `evidence lineage has ${lineage.gaps.length} gap(s)`);
    else add("evidence", 1, `${trace.evidence.length} evidence row(s), lineage complete to a registered capability`);

    // integrity - READ A6's recorded verdict
    if (integrityPassed === true) add("integrity", 1, "output integrity check passed (A6)");
    else if (integrityPassed === false) add("integrity", 0, `output integrity check FAILED (A6): ${integrityViolationCount} violation(s)`);
    else add("integrity", succeeded ? 0.5 : 1, "integrity gate not reached (run ended before synthesis)");

    // limits_respected
    const withinCredit = creditsCharged <= maxCreditCost + 1e-9;
    if (RESOURCE_LIMIT_STATUSES.has(status))
      add("limits_respected", 0.5, `run hit a resource ceiling (${status}) - respected, but the run was constrained`);
    else if (!withinCredit)
      add("limits_respected", 0.2, `charged ${creditsCharged} > maxCreditCost ${maxCreditCost}`);
    else add("limits_respected", 1, `within all run limits; charged ${creditsCharged} of ${maxCreditCost === Infinity ? "n/a" : maxCreditCost}`);

    // groundedness
    if (!succeeded) add("groundedness", 0.1, "no conclusion (run did not succeed)");
    else if (output.resolved === true && (output.basis?.length ?? 0) > 0 && (output.evidenceIds?.length ?? 0) > 0 && lineage.complete)
      add("groundedness", 1, `resolved conclusion (${output.bias ?? "n/a"}) with a non-empty basis and complete evidence lineage`);
    else if (output.resolved === true)
      add("groundedness", 0.6, "resolved conclusion but the basis / evidence linkage is incomplete");
    else add("groundedness", 0.5, "an honest 'unresolved' conclusion - not grounded, but not fabricated");

    // ================= composite + failure analysis =================
    const compositeScore = scores.reduce((s, x) => s + x.score * WEIGHTS[x.dimension], 0);

    const failureCategory = this.categorize(status, run.errorCode, deniedGateCount, integrityPassed);
    const failureAnalysis = this.analyze(trace, status, run.errorCode, run.errorMessage, failureCategory);

    const wallMs = run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : 0;

    const result: AgentEvaluationResult = {
      runId,
      agentId: run.agentId,
      userId: run.userId,
      terminalStatus: status,
      scores,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      failureCategory,
      failureAnalysis,
      measurableSignals: {
        stepCount: trace.steps.length,
        toolCallCount: trace.toolCalls.length,
        executedToolCount: executed.length,
        evidenceCount: trace.evidence.length,
        lineageComplete: lineage.complete,
        lineageGaps: lineage.gaps.length,
        deniedGateCount,
        integrityPassed: integrityPassed ?? false,
        integrityViolationCount,
        creditsCharged,
        wallMs,
        planningPath: planMeta.planningPath ?? "unknown",
        specialist: planMeta.specialist ?? "unknown",
        terminalStatus: status,
        errorCode: run.errorCode ?? "",
        agentType: definition?.type ?? "unknown",
        resolved: output.resolved === true,
      },
      evaluatorVersion: EVALUATOR_VERSION,
      createdAt: new Date().toISOString(),
    };

    const persisted = await this.store.upsert(result);
    log.info("run evaluated", {
      runId, terminalStatus: status, compositeScore: persisted.compositeScore, failureCategory,
    });
    return persisted;
  }

  async getForRun(runId: string): Promise<AgentEvaluationResult | null> {
    return this.store.getByRunId(runId);
  }

  private categorize(
    status: AgentRunStatus,
    errorCode: string | null | undefined,
    deniedGates: number,
    integrityPassed: boolean | undefined,
  ): RunFailureCategory {
    if (status === "succeeded") return "none";
    if (integrityPassed === false || errorCode === "output_integrity") return "integrity";
    if (status === "credit_limit" || errorCode === "insufficient_credits") return "credit";
    if (RESOURCE_LIMIT_STATUSES.has(status)) return "resource_limit";
    if (status === "permission_denied" && deniedGates > 0) return "expected_guardrail";
    if (status === "tool_error") return "provider_failure";
    return "unexpected";
  }

  private analyze(
    trace: Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>,
    status: AgentRunStatus,
    errorCode: string | null | undefined,
    errorMessage: string | null | undefined,
    category: RunFailureCategory,
  ): string {
    if (status === "succeeded") {
      return `run completed. ${trace.toolCalls.length} tool call(s), ${trace.evidence.length} evidence row(s); output integrity passed.`;
    }
    const last = trace.steps[trace.steps.length - 1];
    return (
      `run ended '${status}' (category: ${category}). errorCode=${errorCode ?? "none"}. ` +
      `${errorMessage ? `message: ${errorMessage.slice(0, 300)}. ` : ""}` +
      `last step: ${last ? `${last.kind}/${last.status} - ${last.summary}` : "none"}.`
    );
  }
}

export const evaluationService = new EvaluationService();
