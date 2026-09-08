// services/agent-framework/supervisor/supervisor.ts
// AT24 Agent Framework - A5. The Supervisor / Orchestrator: the REAL planner
// sitting above the deterministic A4 runtime.
//
// LOCKED (owner G04):
//  - tick() stays the execution primitive. The Supervisor produces the
//    plan/intent state; A4 authorizes + executes it one bounded slice per tick.
//  - Two planning paths:
//      1. DETERMINISTIC FIRST - a specialist builds a valid plan with NO LLM.
//      2. LLM-ASSISTED SECOND - only when explicitly enabled AND the goal
//         looks complex; the LLM only PROPOSES a selection/ordering of tools
//         the agent is already bound to, which is then VALIDATED against
//         bindings/registry/permissions/autonomy before use. LLM failure or
//         an empty validated result -> the deterministic plan. Planning never
//         fails a run.
//  - Specialists are planning/reasoning ROLES sharing one runtime, registry,
//    governance, evidence model, memory and credit system - never separate
//    engines.

import type { AgentDefinition } from "@/types/agent-framework";
import { logger } from "@/services/backend/Logger";
import { toolRegistry } from "../tools/registry-manifest";
import type { ToolRegistry } from "../tools/tool-registry";
import type { RunPlanner, RunPlan, RunSynthesis, RunPlanContext, RunTrace } from "./run-planner";
import { parseGoal } from "./goal";
import { selectSpecialist } from "./specialist-registry";
import {
  type PlanProposer,
  LlmPlanProposer,
  validateProposedPlan,
  llmPlanningEnabled,
} from "./plan-proposer";

const log = logger.child("agent-supervisor");

export interface SupervisorDeps {
  registry?: ToolRegistry;
  /** Injectable for tests; defaults to the LLM-backed proposer. */
  proposer?: PlanProposer;
  /** Force-enable/disable LLM-assist regardless of env (tests). */
  llmAssist?: boolean;
}

export class SupervisorService implements RunPlanner {
  private readonly registry: ToolRegistry;
  private readonly proposer: PlanProposer;
  private readonly llmAssist: boolean;

  constructor(deps: SupervisorDeps = {}) {
    this.registry = deps.registry ?? toolRegistry;
    this.proposer = deps.proposer ?? new LlmPlanProposer();
    this.llmAssist = deps.llmAssist ?? llmPlanningEnabled();
  }

  async plan(definition: AgentDefinition, input: unknown, ctx: RunPlanContext): Promise<RunPlan> {
    const goal = parseGoal(input);
    const boundToolIds = definition.tools.map((b) => b.toolId);
    const specialist = selectSpecialist(definition.type);

    // ---- 1. deterministic plan (always computed) ----
    const deterministic = specialist.planTools(definition, goal, boundToolIds);

    let requests = deterministic.requests;
    let rationale = deterministic.rationale;
    let planningPath: "deterministic" | "llm-assisted" = "deterministic";
    const planMetadata: Record<string, unknown> = {
      specialist: specialist.key,
      goalSymbol: goal.symbol ?? null,
      goalComplex: goal.isComplex,
    };

    // ---- 2. LLM-assisted refinement (opt-in, complex goals only) ----
    if (this.llmAssist && goal.isComplex && boundToolIds.length > 1) {
      try {
        const tools = boundToolIds
          .map((id) => this.registry.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => ({ id: t.definition.id, description: t.definition.description }));
        const proposal = await this.proposer.propose({ goal, tools });
        const validated = validateProposedPlan(proposal, definition, goal, boundToolIds, this.registry);
        planMetadata.llmProposedSteps = proposal.steps.map((s) => s.toolId);
        planMetadata.llmRejected = validated.rejected;
        if (validated.requests.length > 0) {
          requests = validated.requests;
          rationale = `LLM-assisted plan (validated): ${validated.requests.map((r) => r.toolId).join(" -> ")}`;
          planningPath = "llm-assisted";
        } else {
          log.info("LLM plan produced nothing valid; keeping deterministic plan", { runId: ctx.runId });
        }
      } catch (err) {
        log.info("LLM planning failed; keeping deterministic plan", {
          runId: ctx.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    planMetadata.planningPath = planningPath;
    log.info("plan produced", {
      runId: ctx.runId,
      specialist: specialist.key,
      planningPath,
      steps: requests.map((r) => r.toolId),
    });

    return { requests, rationale, planMetadata };
  }

  async synthesizeOutput(trace: RunTrace, definition: AgentDefinition): Promise<RunSynthesis> {
    // Re-select the same specialist deterministically (Supervisor is stateless
    // across ticks - a fresh instance must reach the same conclusion).
    const specialist = selectSpecialist(definition.type);
    const goal = parseGoal((trace.run?.input as unknown) ?? {});
    return specialist.synthesize(trace, definition, goal);
  }
}

export const supervisor = new SupervisorService();
