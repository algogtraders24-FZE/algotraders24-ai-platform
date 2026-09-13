// services/agent-framework/agents/support-agent.ts
// AT24 Agent Framework - CS1. The Chat Support Agent.
//
// LOCKED (same shape as A11-A13): a canonical AgentDefinition + a thin
// entrypoint. NO new runtime, NO new planner, NO new store, NO migration. It
// runs on the SAME A4 runtime, A5 Supervisor, A6 integrity gate and A8/A9/A10
// governance as every other agent. The Support specialisation lives in
// supervisor/specialists/support.specialist.ts (planning + synthesis only).
//
// LOCKED (CS1.2):
//   D1 STRICT SEPARATION - shares nothing with the main AI Assistant: not
//      services/ai/*, not the knowledge chat route, not the Conversation
//      stack. Its own route + nav + tools.
//   D2 The knowledge it reads is the platform's GOVERNED support corpus
//      (scope="support"), retrieved through the existing eligibility-filtered
//      searchSimilar contract - never a private per-user KB.
//   D4 Read-only. Bound to exactly two tools, both non-mutating:
//      support.knowledge_search (the corpus) and support.account_read (the
//      requester's OWN plan / subscription / purchase / license STATUS).
//      Permission seeds: CAN_RUN_SUPPORT, CAN_READ_ACCOUNT_RECORDS - both
//      autonomy-floor 0, never dangerous. No signal / order / write permission.
//   D5 Unresolved -> a structured escalate:true hand-off. No ticket is
//      created in this slice (CS2).
//   D6 Output = citations + account-status findings + escalation decision.
//      No prose answer, no passage text (A6 signal-language safe).

import {
  type AgentDefinition,
  makeDefaultAgentDefinitionBase,
} from "@/types/agent-framework";
import { AGENT_TYPE_REGISTRY } from "../agent-type-registry";
import { AgentRuntime, agentRuntime } from "../runtime/agent-runtime";
import type { AgentRunRow } from "../runtime/agent-run.repository";

/** The tools the Support Agent is bound to - the full SUPPORT seed list. */
export const SUPPORT_AGENT_TOOL_IDS = ["support.knowledge_search", "support.account_read"] as const;

export interface SupportAgentOptions {
  id?: string;
  slug?: string;
  version?: string;
  objective?: string;
  instructions?: string;
}

/** Build the canonical Support Agent definition. Pure - passes
 *  `validateAgentDefinition` against the SUPPORT registry entry (autonomy cap
 *  1, permission seeds CAN_RUN_SUPPORT / CAN_READ_ACCOUNT_RECORDS). */
export function supportAgentDefinition(opts: SupportAgentOptions = {}): AgentDefinition {
  const now = new Date().toISOString();
  const spec = AGENT_TYPE_REGISTRY.SUPPORT;
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: opts.id ?? "agt_support_canonical",
    slug: opts.slug ?? "support-agent",
    version: opts.version ?? "1.0.0",
    name: spec.label,
    description:
      "Answers a platform / product / billing / licensing support question strictly from the governed support " +
      "knowledge base and, for account questions, the read-only status of the requester's own records. Returns " +
      "an evidence-first cited answer or a structured hand-off to human support. Read-only; never a trade or an " +
      "account change.",
    type: "SUPPORT",
    status: "active",
    objective:
      opts.objective ??
      "Given a support question, gather relevant material from the support knowledge base (and, when the question " +
        "is about the requester's own account, that account's status), then produce an evidence-first answer that " +
        "cites every source, or escalate to a human.",
    instructions:
      opts.instructions ??
      "Plan within the two bound tools only. Never fabricate a source or restate source text as your own answer - " +
        "cite the evidence row. Never attempt an account change; when the question needs one, or the knowledge base " +
        "has no answer, escalate.",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: SUPPORT_AGENT_TOOL_IDS.map((toolId) => ({ toolId })),
    permissionPolicy: { granted: [...spec.defaultPermissions] },
    autonomyLevel: 1,
    outputSchema: {
      type: "object",
      required: ["kind", "resolved", "coverage", "escalate", "evidenceIds", "disclaimer"],
      properties: {
        kind: { type: "string", enum: ["support-answer"] },
        resolved: { type: "boolean" },
        coverage: { type: "string", enum: ["kb-answered", "account-context", "no-coverage"] },
        citationCount: { type: "integer", minimum: 0 },
        topics: { type: "array" },
        citations: { type: "array" },
        accountFindings: { type: "array" },
        escalate: { type: "boolean" },
        escalationReason: { type: ["string", "null"] },
        evidenceCount: { type: "integer", minimum: 0 },
        evidenceIds: { type: "array" },
        disclaimer: { type: "string" },
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface RunSupportAgentInput {
  userId: string;
  /** The support question - a string, or `{ question }`. */
  goal: string | { question: string };
  /** Inject a runtime (tests). Defaults to the process-wide `agentRuntime`. */
  runtime?: AgentRuntime;
  definitionOverrides?: SupportAgentOptions;
}

/** Start + drive a Support Agent run to completion on the shared runtime. */
export async function runSupportAgent(input: RunSupportAgentInput): Promise<AgentRunRow> {
  const runtime = input.runtime ?? agentRuntime;
  const { runId } = await runtime.startRun({
    definition: supportAgentDefinition(input.definitionOverrides),
    input: input.goal,
    userId: input.userId,
    trigger: "manual",
  });
  return runtime.runToCompletion(runId);
}
