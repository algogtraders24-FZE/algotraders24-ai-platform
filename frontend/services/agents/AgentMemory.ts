// services/agents/AgentMemory.ts
// Per-agent memory store. Sprint 14E - hydrated from PostgreSQL.
// New entries are held in memory; persisting writes lands with the agent
// execution sprint.
import type { MemoryEntry } from "@/types/agent";
import { AGENT_CONFIG } from "@/config/agent.config";

let store: MemoryEntry[] = [];

export function hydrateMemory(entries: MemoryEntry[]): void {
  store = [...entries];
}

export function getMemory(agentId: string): MemoryEntry[] {
  return store.filter((m) => m.agentId === agentId);
}

export function remember(
  agentId: string,
  key: string,
  value: string
): MemoryEntry {
  const entry: MemoryEntry = {
    id: `mem-${Date.now()}`,
    agentId,
    key,
    value,
    createdAt: new Date().toISOString(),
  };
  store = [entry, ...store].slice(0, AGENT_CONFIG.maxMemoryEntries);
  return entry;
}

export function clearMemory(agentId: string): void {
  store = store.filter((m) => m.agentId !== agentId);
}