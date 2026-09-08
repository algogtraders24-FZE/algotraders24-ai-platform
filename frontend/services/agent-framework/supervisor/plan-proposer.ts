// services/agent-framework/supervisor/plan-proposer.ts
// AT24 Agent Framework - A5. LLM-assisted planning, behind a hard boundary.
//
// LOCKED (owner G04):
//   LLM -> structured proposed plan -> VALIDATION -> AT24 Supervisor ->
//   PlannerToolRequest -> Authorization -> Tool Registry
//   NEVER:  LLM -> arbitrary function/tool
//
// The LLM may only propose a SELECTION + ORDERING of tools the agent is
// ALREADY bound to. Every proposed step is re-checked against: bound-tool
// membership, registry presence, active status, the agent's PermissionPolicy
// and its autonomyLevel. Anything else is dropped. A proposer failure or an
// empty validated result falls back to the deterministic specialist plan -
// planning never fails a run.

import {
  type AgentDefinition,
  type PlannerToolRequest,
  evaluatePermission,
  canRunAtAutonomy,
} from "@/types/agent-framework";
import type { ToolRegistry } from "../tools/tool-registry";
import type { ParsedGoal } from "./goal";
import { shapeGoalForTool } from "./plan-shaping";

export interface ProposedStep {
  toolId: string;
  reason?: string;
}
export interface ProposedPlan {
  steps: ProposedStep[];
}

export interface PlanProposalRequest {
  goal: ParsedGoal;
  /** tools the agent is bound to, with their descriptions. */
  tools: { id: string; description: string }[];
}

export interface PlanProposer {
  propose(req: PlanProposalRequest): Promise<ProposedPlan>;
}

// ---- validation (the governance boundary) --------------------------------

export interface ValidatedProposal {
  requests: PlannerToolRequest[];
  rejected: { toolId: string; reason: string }[];
}

export function validateProposedPlan(
  proposal: ProposedPlan,
  definition: AgentDefinition,
  goal: ParsedGoal,
  boundToolIds: string[],
  registry: ToolRegistry,
): ValidatedProposal {
  const requests: PlannerToolRequest[] = [];
  const rejected: { toolId: string; reason: string }[] = [];
  const bound = new Set(boundToolIds);
  const seen = new Set<string>();

  for (const step of proposal.steps ?? []) {
    const toolId = typeof step?.toolId === "string" ? step.toolId : "";
    if (!toolId) {
      rejected.push({ toolId: String(step?.toolId), reason: "missing toolId" });
      continue;
    }
    if (seen.has(toolId)) {
      rejected.push({ toolId, reason: "duplicate step" });
      continue;
    }
    seen.add(toolId);

    if (!bound.has(toolId)) {
      rejected.push({ toolId, reason: "agent is not bound to this tool" });
      continue;
    }
    const impl = registry.get(toolId);
    if (!impl) {
      rejected.push({ toolId, reason: "not in the tool registry" });
      continue;
    }
    if (impl.definition.status !== "active") {
      rejected.push({ toolId, reason: `tool is ${impl.definition.status}` });
      continue;
    }
    if (!evaluatePermission(definition.permissionPolicy, impl.definition.requiredPermissions).allowed) {
      rejected.push({ toolId, reason: "agent permission policy does not grant this tool" });
      continue;
    }
    if (!canRunAtAutonomy(definition.autonomyLevel, impl.definition.autonomyFloor)) {
      rejected.push({ toolId, reason: "agent autonomy level is below the tool floor" });
      continue;
    }

    requests.push({
      toolId,
      input: shapeGoalForTool(toolId, goal),
      rationale: `LLM-assisted: ${step.reason ?? "selected for the goal"} (validated against bindings/permissions/autonomy)`,
    });
  }

  return { requests, rejected };
}

// ---- the lib/ai-backed proposer -----------------------------------------

/** Uses the vendor-neutral lib/ai AIService purely as a planning assistant.
 *  Lazy-imports lib/ai so a deterministic run never loads a provider. */
export class LlmPlanProposer implements PlanProposer {
  async propose(req: PlanProposalRequest): Promise<ProposedPlan> {
    const { createAIService } = await import("@/lib/ai");
    const ai = createAIService();

    const toolList = req.tools.map((t) => `- ${t.id}: ${t.description}`).join("\n");
    const prompt =
      `You are a planning assistant for an analysis agent. You do NOT execute anything.\n` +
      `Goal: ${req.goal.question || JSON.stringify(req.goal.raw)}\n` +
      (req.goal.symbol ? `Instrument: ${req.goal.symbol}\n` : "") +
      `Available tools (you may ONLY choose from these ids):\n${toolList}\n\n` +
      `Return ONLY a compact JSON object: {"steps":[{"toolId":"<id>","reason":"<short>"}]} ` +
      `ordering the tools needed to address the goal. Use each tool at most once. No prose.`;

    const res = await ai.complete(prompt);
    return parseProposedPlan(res.content);
  }
}

export function parseProposedPlan(raw: string): ProposedPlan {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return { steps: [] };
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { steps?: unknown };
    if (!Array.isArray(obj.steps)) return { steps: [] };
    return {
      steps: obj.steps
        .filter((s): s is ProposedStep => !!s && typeof (s as ProposedStep).toolId === "string")
        .map((s) => ({ toolId: s.toolId, reason: typeof s.reason === "string" ? s.reason : undefined })),
    };
  } catch {
    return { steps: [] };
  }
}

/** True when the operator has explicitly enabled LLM-assisted planning. */
export function llmPlanningEnabled(): boolean {
  const v = (process.env.AGENT_LLM_PLANNING ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
