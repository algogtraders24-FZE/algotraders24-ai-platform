// services/agents/AgentRegistry.ts
// Central registry of all AI agents. The Manager loads from here.

import type { Agent, AgentType } from "@/types/agent";
import { mockAgents } from "@/data/mock-agents";

const registry: Map<string, Agent> = new Map(mockAgents.map((a) => [a.id, a]));

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