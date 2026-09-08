// services/agent-framework/integrity/evidence-lineage.ts
// AT24 Agent Framework - A6. Traverse an agent conclusion back to the real
// AT24 capability that produced its evidence:
//
//   Final Output -> evidenceIds -> AgentEvidence -> AgentToolCall ->
//   AgentStep -> AgentRun -> a registered tool (the real AT24 capability)
//
// Pure: takes the persisted trace + the tool registry, returns the chain and
// any gaps. No I/O.

import type { RunTrace } from "../supervisor/run-planner";
import type { ToolRegistry } from "../tools/tool-registry";

export interface LineageLink {
  evidenceId: string;
  stepId: string | null;
  toolCallId: string | null;
  toolId: string | null;
  /** the `wraps` pointer of the registered tool, i.e. the real AT24 service. */
  capability: string | null;
  provenanceProducer: string | null;
}

export interface LineageResult {
  links: LineageLink[];
  /** every referenced id resolved all the way to a registered capability. */
  complete: boolean;
  gaps: string[];
}

/** Extract the evidence ids a structured output claims to be backed by. */
export function outputEvidenceIds(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const ids = (output as Record<string, unknown>).evidenceIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

export function buildLineage(output: unknown, trace: RunTrace, registry: ToolRegistry): LineageResult {
  const runId = trace.run?.id ?? null;
  const evById = new Map(trace.evidence.map((e) => [e.id, e]));
  const stepById = new Map(trace.steps.map((s) => [s.id, s]));
  const tcById = new Map(trace.toolCalls.map((t) => [t.id, t]));

  const referenced = outputEvidenceIds(output);
  const links: LineageLink[] = [];
  const gaps: string[] = [];

  for (const evId of referenced) {
    const ev = evById.get(evId);
    if (!ev) {
      gaps.push(`evidenceId "${evId}" is not in this run`);
      links.push({ evidenceId: evId, stepId: null, toolCallId: null, toolId: null, capability: null, provenanceProducer: null });
      continue;
    }
    if (runId && ev.runId !== runId) {
      gaps.push(`evidence "${evId}" belongs to run "${ev.runId}", not "${runId}"`);
    }

    const step = ev.stepId ? stepById.get(ev.stepId) ?? null : null;
    if (!step) gaps.push(`evidence "${evId}" -> step "${ev.stepId}" not found in this run`);

    let toolId: string | null = null;
    let capability: string | null = null;
    if (ev.toolCallId) {
      const tc = tcById.get(ev.toolCallId) ?? null;
      if (!tc) {
        gaps.push(`evidence "${evId}" -> toolCall "${ev.toolCallId}" not found in this run`);
      } else {
        if (runId && tc.runId !== runId) gaps.push(`toolCall "${tc.id}" belongs to a different run`);
        toolId = tc.toolId;
        const impl = registry.get(tc.toolId);
        if (!impl) gaps.push(`toolCall "${tc.id}" -> tool "${tc.toolId}" is not a registered capability`);
        else capability = impl.definition.wraps;
      }
    }

    const prov = (ev.provenance ?? {}) as { producer?: unknown };
    links.push({
      evidenceId: evId,
      stepId: ev.stepId ?? null,
      toolCallId: ev.toolCallId ?? null,
      toolId,
      capability,
      provenanceProducer: typeof prov.producer === "string" ? prov.producer : null,
    });
  }

  return { links, complete: gaps.length === 0, gaps };
}
