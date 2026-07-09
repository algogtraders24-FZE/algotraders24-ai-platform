// services/agents/AgentPlanner.ts
// Breaks a goal or user request into a list of tasks for an agent.
// Mock planner: derives simple tasks from the agent's tools + request.

import type { Agent, AgentTask } from "@/types/agent";
import { resolveTools } from "./AgentTools";

export function planTasks(agent: Agent, request: string): AgentTask[] {
  const tools = resolveTools(agent.tools);
  const now = new Date().toISOString();

  // One planning task per tool the agent owns, framed around the request.
  const toolTasks: AgentTask[] = tools.map((tool, i) => ({
    id: `task-${Date.now()}-${i}`,
    agentId: agent.id,
    title: `${tool.name}: ${request}`,
    status: "queued",
    createdAt: now,
    finishedAt: null,
  }));

  // Always finish with a synthesis task.
  toolTasks.push({
    id: `task-${Date.now()}-final`,
    agentId: agent.id,
    title: `Synthesize result for: ${request}`,
    status: "queued",
    createdAt: now,
    finishedAt: null,
  });

  return toolTasks;
}