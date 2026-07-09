// types/agent.ts
// AI Agent Framework — core types

import type { ProviderName } from "./provider-name";

export type AgentStatus = "running" | "idle" | "busy" | "offline" | "paused";

export type AgentType =
  | "market-analyst"
  | "trading-copilot"
  | "risk-manager"
  | "seo-writer"
  | "news-researcher"
  | "portfolio-advisor"
  | "customer-support"
  | "strategy-generator";

/** A tool an agent can call (registry entry). */
export interface AgentTool {
  id: string;
  name: string;
  description: string;
}

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  avatar: string; // short label / emoji-free initials
  status: AgentStatus;
  provider: ProviderName;
  version: string;
  memoryEnabled: boolean;
  tools: string[]; // tool ids
  capabilities: string[];
  goal: string;
  priority: number; // 1 (high) – 5 (low)
  lastRun: string | null;
  nextRun: string | null;
  tasksCompleted: number;
  successRate: number; // 0–100
  estimatedCost: number;
}

export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface AgentTask {
  id: string;
  agentId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  finishedAt: string | null;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  key: string;
  value: string;
  createdAt: string;
}

export interface AgentActivity {
  id: string;
  agentId: string;
  message: string;
  timestamp: string;
}

export interface AgentMetrics {
  totalAgents: number;
  running: number;
  idle: number;
  busy: number;
  successRate: number; // 0–100
  tasksToday: number;
}