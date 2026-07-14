// services/agents/AgentRegistry.ts
// Central registry of all AI agents. The Manager loads from here.
// Sprint 14E - Hydrated from PostgreSQL; no mock seed.
import type { Agent, AgentType } from "@/types/agent";

const registry: Map<string, Agent> = new Map();

export function hydrateAgents(agents: Agent[]): void {
  registry.clear();
  for (const a of agents) registry.set(a.id, a);
}

export function registerAgent(agent: Agent): void {
  registry.set(agent.id, agent);
}

export function getRegisteredAgents(): Agent[] {
  return Array.from(registry.values());
}

export function getAgentById(id: string): Agent | undefined {
  return registry.get(id);
}

export function getAgentsByType(type: AgentType): Agent[] {
  return getRegisteredAgents().filter((a) => a.type === type);
}