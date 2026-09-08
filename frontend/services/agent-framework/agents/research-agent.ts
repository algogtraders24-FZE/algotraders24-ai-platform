// services/agent-framework/agents/research-agent.ts
// AT24 Agent Framework - A11. The Research Agent.
//
// LOCKED (owner G10): "A11-A13 should primarily add: agent definitions +
// bounded plans + tool bindings + domain synthesis - not new infrastructure."
// This file is exactly that: a canonical AgentDefinition + a thin entrypoint.
// It adds NO runtime, NO planner, NO store. It runs on the SAME A4 runtime,
// the SAME A5 Supervisor, the SAME A6 integrity gate, the SAME A8/A9/A10
// governance as every other agent. The Research specialisation lives in
// supervisor/specialists/research.specialist.ts (planning + synthesis only).
//
// LOCKED (owner G10): "do not invent a new research engine or web-search
// provider." The agent is bound to exactly two tools, both thin adapters
// over EXISTING AT24 capabilities:
//   research.knowledge_search -> the user's own pgvector Knowledge/RAG store
//   news.search               -> AlphaVantageNewsProvider (15D pipeline's)
// research.web_search is deliberately NOT registered and NOT bound.

import {
  type AgentDefinition,
  makeDefaultAgentDefinitionBase,
} from "@/types/agent-framework";
import { AGENT_TYPE_REGISTRY } from "../agent-type-registry";
import { AgentRuntime, agentRuntime } from "../runtime/agent-runtime";
import type { AgentRunRow } from "../runtime/agent-run.repository";

/** The tools the Research Agent is bound to. A subset of the RESEARCH type's
 *  seed list - `research.web_search` is intentionally excluded (no provider). */
export const RESEARCH_AGENT_TOOL_IDS = ["research.knowledge_search", "news.search"] as const;

export interface ResearchAgentOptions {
  /** Stable per-user id + slug so re-creation is idempotent upstream. */
  id?: string;
  slug?: string;
  version?: string;
  /** Override the objective / instructions text. */
  objective?: string;
  instructions?: string;
}

/** Build the canonical Research Agent definition. Pure - passes
 *  `validateAgentDefinition` against the RESEARCH registry entry (autonomy
 *  cap 1, permission seeds CAN_RUN_RESEARCH / CAN_READ_NEWS / CAN_USE_MEMORY). */
export function researchAgentDefinition(opts: ResearchAgentOptions = {}): AgentDefinition {
  const now = new Date().toISOString();
  const spec = AGENT_TYPE_REGISTRY.RESEARCH;
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: opts.id ?? "agt_research_canonical",
    slug: opts.slug ?? "research-agent",
    version: opts.version ?? "1.0.0",
    name: spec.label,
    description:
      "Answers a research question strictly from the user's own knowledge base and the platform news " +
      "provider, and returns an evidence-first citation brief. No web search, no summarisation of source text.",
    type: "RESEARCH",
    status: "active",
    objective:
      opts.objective ??
      "Given a research question, gather relevant material from the knowledge base and recent news, then " +
        "produce an evidence-first brief that cites every source.",
    instructions:
      opts.instructions ??
      "Plan within the two bound tools only. Never fabricate a source or restate source text as your own " +
        "finding - cite the evidence row. The brief is decision support, never a trade recommendation.",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: RESEARCH_AGENT_TOOL_IDS.map((toolId) => ({ toolId })),
    permissionPolicy: { granted: [...spec.defaultPermissions] },
    autonomyLevel: 1,
    outputSchema: {
      type: "object",
      required: ["kind", "resolved", "coverage", "evidenceIds", "disclaimer"],
      properties: {
        kind: { type: "string", enum: ["research-brief"] },
        question: { type: "string" },
        resolved: { type: "boolean" },
        coverage: { type: "string", enum: ["knowledge-backed", "news-only", "no-coverage"] },
        citationCount: { type: "integer", minimum: 0 },
        knowledgeHits: { type: "integer", minimum: 0 },
        newsHits: { type: "integer", minimum: 0 },
        citations: { type: "array" },
        sources: { type: "array" },
        evidenceCount: { type: "integer", minimum: 0 },
        evidenceIds: { type: "array" },
        disclaimer: { type: "string" },
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface RunResearchAgentInput {
  userId: string;
  /** The research question - a string, or `{ question, symbol? }`. */
  goal: string | { question: string; symbol?: string };
  /** Inject a runtime (tests). Defaults to the process-wide `agentRuntime`. */
  runtime?: AgentRuntime;
  definitionOverrides?: ResearchAgentOptions;
}

/** Start + drive a Research Agent run to completion on the shared runtime. */
export async function runResearchAgent(input: RunResearchAgentInput): Promise<AgentRunRow> {
  const runtime = input.runtime ?? agentRuntime;
  const { runId } = await runtime.startRun({
    definition: researchAgentDefinition(input.definitionOverrides),
    input: input.goal,
    userId: input.userId,
    trigger: "manual",
  });
  return runtime.runToCompletion(runId);
}
