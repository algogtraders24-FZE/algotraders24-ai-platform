// services/agents/AgentManager.ts
// Loads and manages agents. Owns status transitions (run/pause/resume).

import type { Agent, AgentStatus } from "@/types/agent";
import { getRegisteredAgents, getAgentById, registerAgent } from "./AgentRegistry";

export function loadAgents(): Agent[] {
  return getRegisteredAgents();
}

export function getAgent(id: string): Agent | undefined {
  return getAgentById(id);
}

function setStatus(id: string, status: AgentStatus): Agent | undefined {
  const agent = getAgentById(id);
  if (!agent) return undefined;
  const updated: Agent = { ...agent, status };
  registerAgent(updated);
  return updated;
}

export function runAgent(id: string): Agent | undefined {
  return setStatus(id, "running");
}

export function pauseAgent(id: string): Agent | undefined {
  return setStatus(id, "paused");
}

export function resumeAgent(id: string): Agent | undefined {
  return setStatus(id, "idle");
}