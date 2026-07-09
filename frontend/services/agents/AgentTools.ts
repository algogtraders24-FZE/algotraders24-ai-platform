// services/agents/AgentTools.ts
// Tool registry. Agents reference tools by id; this resolves them.

import type { AgentTool } from "@/types/agent";
import { agentTools } from "@/data/mock-agents";

const tools: Map<string, AgentTool> = new Map(agentTools.map((t) => [t.id, t]));

export function getTool(id: string): AgentTool | undefined {
  return tools.get(id);
}

export function getAllTools(): AgentTool[] {
  return Array.from(tools.values());
}

export function resolveTools(ids: string[]): AgentTool[] {
  return ids.map((id) => tools.get(id)).filter((t): t is AgentTool => Boolean(t));
}