// services/agents/AgentTaskManager.ts
// Task queue for agents. Sprint 14E - hydrated from PostgreSQL.
import type { AgentTask } from "@/types/agent";
import { AGENT_CONFIG } from "@/config/agent.config";

let queue: AgentTask[] = [];

export function hydrateTasks(tasks: AgentTask[]): void {
  queue = [...tasks];
}

export function getTasks(agentId?: string): AgentTask[] {
  return agentId ? queue.filter((t) => t.agentId === agentId) : queue;
}

export function enqueueTasks(tasks: AgentTask[]): void {
  queue = [...tasks, ...queue];
}

export function getRunningCount(): number {
  return queue.filter((t) => t.status === "running").length;
}

export function canRunMore(): boolean {
  return getRunningCount() < AGENT_CONFIG.maxConcurrentTasks;
}

export function markDone(taskId: string): void {
  queue = queue.map((t) =>
    t.id === taskId
      ? { ...t, status: "done", finishedAt: new Date().toISOString() }
      : t
  );
}