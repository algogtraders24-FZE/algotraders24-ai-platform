// repositories/AgentRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface AgentEntity extends BaseEntity {
  userId: string;
  name: string;
  type: string;
  status: "active" | "paused" | "archived";
}

const SEED: AgentEntity[] = [
  {
    id: "agent_1",
    userId: "u1",
    name: "Signal Scout",
    type: "market-scanner",
    status: "active",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
  },
];

export class AgentRepository extends BaseRepository<AgentEntity> {
  protected entityName = "agent";

  constructor() {
    super(SEED);
  }

  async findByUser(userId: string): Promise<AgentEntity[]> {
    const all = await this.findAll();
    return all.filter((a) => a.userId === userId);
  }
}
