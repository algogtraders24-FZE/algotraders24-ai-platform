// repositories/UserRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface UserEntity extends BaseEntity {
  email: string;
  name: string;
  role: "user" | "admin";
  planId: string;
  status: "active" | "suspended";
}

const SEED: UserEntity[] = [
  {
    id: "u1",
    email: "trader@algotraders24.ai",
    name: "Demo Trader",
    role: "user",
    planId: "pro",
    status: "active",
    createdAt: "2025-11-15T09:00:00.000Z",
    updatedAt: "2025-11-15T09:00:00.000Z",
  },
];

export class UserRepository extends BaseRepository<UserEntity> {
  protected entityName = "user";

  constructor() {
    super(SEED);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const all = await this.findAll();
    return all.find((u) => u.email === email) ?? null;
  }
}
