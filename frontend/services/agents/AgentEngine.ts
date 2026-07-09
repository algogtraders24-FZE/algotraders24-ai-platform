// services/agents/AgentEngine.ts
// Main orchestration layer and public facade for the agent framework.
// Implements the workflow: request -> manager -> planner -> task queue ->
// executor -> memory -> result. UI talks only to this module.

import type { Agent, AgentActivity, AgentMetrics } from "@/types/agent";
import { loadAgents, getAgent } from "./AgentManager";
import { planTasks } from "./AgentPlanner";
import { enqueueTasks, getTasks } from "./AgentTaskManager";
import { executeTasks } from "./AgentExecutor";
import { mockActivity } from "@/data/mock-agents";

export interface AgentRunResult {
  agentId: string;
  activity: AgentActivity[];
}

/** Run an agent against a request through the full pipeline. */
export async function runAgentPipeline(agentId: string, request: string): Promise<AgentRunResult | null> {
  const agent = getAgent(agentId);
  if (!agent) return null;

  const tasks = planTasks(agent, request);
  enqueueTasks(tasks);
  const activity = await executeTasks(agent, tasks);

  return { agentId, activity };
}

export function getMetrics(): AgentMetrics {
  const agents: Agent[] = loadAgents();
  const running = agents.filter((a) => a.status === "running").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const busy = agents.filter((a) => a.status === "busy").length;
  const avgSuccess = agents.length
    ? Math.round(agents.reduce((s, a) => s + a.successRate, 0) / agents.length)
    : 0;
  const tasksToday = getTasks().length;

  return {
    totalAgents: agents.length,
    running,
    idle,
    busy,
    successRate: avgSuccess,
    tasksToday,
  };
}

export function getRecentActivity(agentId?: string): AgentActivity[] {
  return agentId ? mockActivity.filter((a) => a.agentId === agentId) : mockActivity;
}