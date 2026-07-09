// config/agent.config.ts
// AI Agent Framework — configuration

import type { AgentType, AgentStatus } from "@/types/agent";

export const AGENT_CONFIG = {
  version: "1.0.0-foundation",
  defaultProvider: "gemini",
  maxConcurrentTasks: 5,
  maxMemoryEntries: 50,
  memoryTtlMinutes: 60,
} as const;

export const AGENT_TYPES: AgentType[] = [
  "market-analyst",
  "trading-copilot",
  "risk-manager",
  "seo-writer",
  "news-researcher",
  "portfolio-advisor",
  "customer-support",
  "strategy-generator",
];

export const AGENT_STATUSES: AgentStatus[] = ["running", "idle", "busy", "offline", "paused"];

/** Status badge colors reused across agent components. */
export const STATUS_STYLES: Record<AgentStatus, string> = {
  running: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  busy: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  idle: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  offline: "bg-red-500/15 text-red-400 border-red-500/30",
};