// repositories/AutomationRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface AutomationEntity extends BaseEntity {
  userId: string;
  name: string;
  trigger: string;
  enabled: boolean;
}

const SEED: AutomationEntity[] = [
  {
    id: "auto_1",
    userId: "u1",
    name: "Daily market digest",
    trigger: "schedule:daily",
    enabled: true,
    createdAt: "2026-05-20T09:00:00.000Z",
    updatedAt: "2026-05-20T09:00:00.000Z",
  },
];

export class AutomationRepository extends BaseRepository<AutomationEntity> {
  protected entityName = "automation";

  constructor() {
    super(SEED);
  }

  async findByUser(userId: string): Promise<AutomationEntity[]> {
    const all = await this.findAll();
    return all.filter((a) => a.userId === userId);
  }
}
