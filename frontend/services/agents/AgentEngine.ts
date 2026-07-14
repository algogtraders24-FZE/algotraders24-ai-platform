// services/agents/AgentEngine.ts
// Main orchestration layer and public facade for the agent framework.
// Sprint 14E - Agents, tasks, memory and activity are loaded from PostgreSQL
// via load(). Every accessor stays synchronous, so callers are unchanged.
import type { Agent, AgentActivity, AgentMetrics } from "@/types/agent";
import { loadAgents, getAgent } from "./AgentManager";
import { planTasks } from "./AgentPlanner";
import { enqueueTasks, getTasks, hydrateTasks } from "./AgentTaskManager";
import { executeTasks } from "./AgentExecutor";
import { hydrateAgents } from "./AgentRegistry";
import { hydrateMemory } from "./AgentMemory";
import { AgentsApi } from "@/services/api/AgentsApi";

let activityLog: AgentActivity[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;

export interface AgentRunResult {
  agentId: string;
  activity: AgentActivity[];
}

export function isLoaded(): boolean {
  return loaded;
}

// Loads the agent framework state and hydrates registry, tasks and memory.
export async function load(
  options: { signal?: AbortSignal; force?: boolean } = {}
): Promise<void> {
  if (loaded && !options.force) return;
  if (inFlight && !options.force) return inFlight;

  if (options.force) AgentsApi.invalidate();

  inFlight = AgentsApi.load({ signal: options.signal }).then((data) => {
    hydrateAgents(data.items);
    hydrateTasks(data.tasks);
    hydrateMemory(data.memory);
    activityLog = data.activity;
    loaded = true;
  });

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Run an agent against a request through the full pipeline. */
export async function runAgentPipeline(
  agentId: string,
  request: string
): Promise<AgentRunResult | null> {
  const agent = getAgent(agentId);
  if (!agent) return null;

  const tasks = planTasks(agent, request);
  enqueueTasks(tasks);
  const activity = await executeTasks(agent, tasks);
  activityLog = [...activity, ...activityLog];
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
  return agentId
    ? activityLog.filter((a) => a.agentId === agentId)
    : activityLog;
}