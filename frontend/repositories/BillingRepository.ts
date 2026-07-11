// repositories/BillingRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface BillingEntity extends BaseEntity {
  userId: string;
  planId: string;
  status: "active" | "canceled" | "past_due";
  amount: number;
}

const SEED: BillingEntity[] = [
  {
    id: "sub_1001",
    userId: "u1",
    planId: "pro",
    status: "active",
    amount: 29,
    createdAt: "2025-11-15T09:00:00.000Z",
    updatedAt: "2026-07-15T09:00:00.000Z",
  },
];

export class BillingRepository extends BaseRepository<BillingEntity> {
  protected entityName = "billing";

  constructor() {
    super(SEED);
  }

  async findByUser(userId: string): Promise<BillingEntity[]> {
    const all = await this.findAll();
    return all.filter((b) => b.userId === userId);
  }
}
