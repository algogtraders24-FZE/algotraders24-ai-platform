// services/agents/AgentMemory.ts
// Temporary per-agent memory store. In-memory only; a future backend can
// implement the same interface with real persistence + TTL.

import type { MemoryEntry } from "@/types/agent";
import { mockMemory } from "@/data/mock-agents";
import { AGENT_CONFIG } from "@/config/agent.config";

let store: MemoryEntry[] = [...mockMemory];

export function getMemory(agentId: string): MemoryEntry[] {
  return store.filter((m) => m.agentId === agentId);
}

export function remember(agentId: string, key: string, value: string): MemoryEntry {
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