// services/api/AgentsApi.ts
// Sprint 14E - Typed access to the agents private API route.
import { ApiClient, type RequestOptions } from "./ApiClient";
import type { Agent, AgentTask, MemoryEntry, AgentActivity } from "@/types/agent";

export interface AgentsEnvelope {
  items: Agent[];
  tasks: AgentTask[];
  memory: MemoryEntry[];
  activity: AgentActivity[];
  total: number;
}

const AGENTS_TTL_MS = 30 * 1000;

export class AgentsApi {
  static async load(options: RequestOptions = {}): Promise<AgentsEnvelope> {
    return ApiClient.get<AgentsEnvelope>("/api/private/agents", {
      cacheTtlMs: AGENTS_TTL_MS,
      retries: 2,
      ...options,
    });
  }

  static invalidate(): void {
    ApiClient.invalidate("/api/private/agents");
  }
}