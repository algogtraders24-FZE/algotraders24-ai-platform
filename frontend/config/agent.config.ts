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

/** Status badge colors reused across agent components.
 * Sprint D1.1 - token-based (success/info/neutral/warning/danger), matching
 * the Badge primitive's tones, replacing raw emerald/indigo/slate/amber/red. */
export const STATUS_STYLES: Record<AgentStatus, string> = {
  running: "bg-success/10 text-success border-success/30",
  busy: "bg-info/10 text-info border-info/30",
  idle: "bg-ink-3 text-text-2 border-border",
  paused: "bg-warning/10 text-warning border-warning/30",
  offline: "bg-danger/10 text-danger border-danger/30",
};