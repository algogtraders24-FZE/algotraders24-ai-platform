// services/agents/AgentExecutor.ts
// Executes an agent's tasks. Mock: simulates each task, writes memory,
// and returns activity entries. No real side effects.

import type { Agent, AgentTask, AgentActivity } from "@/types/agent";
import { remember } from "./AgentMemory";
import { markDone } from "./AgentTaskManager";

export async function executeTasks(agent: Agent, tasks: AgentTask[]): Promise<AgentActivity[]> {
  const activity: AgentActivity[] = [];

  for (const task of tasks) {
    // Simulated execution.
    markDone(task.id);

    if (agent.memoryEnabled) {
      remember(agent.id, "last-task", task.title);
    }

    activity.push({
      id: `act-${Date.now()}-${task.id}`,
      agentId: agent.id,
      message: `Completed: ${task.title}`,
      timestamp: new Date().toISOString(),
    });
  }

  return activity;
}