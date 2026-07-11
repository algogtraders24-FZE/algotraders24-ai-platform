// repositories/KnowledgeRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface KnowledgeEntity extends BaseEntity {
  userId: string;
  title: string;
  source: string;
  chunkCount: number;
  status: "indexed" | "processing" | "failed";
}

const SEED: KnowledgeEntity[] = [
  {
    id: "kb_1",
    userId: "u1",
    title: "Trading Strategy Playbook",
    source: "upload",
    chunkCount: 42,
    status: "indexed",
    createdAt: "2026-06-15T09:00:00.000Z",
    updatedAt: "2026-06-15T09:00:00.000Z",
  },
];

export class KnowledgeRepository extends BaseRepository<KnowledgeEntity> {
  protected entityName = "knowledge";

  constructor() {
    super(SEED);
  }

  async findByUser(userId: string): Promise<KnowledgeEntity[]> {
    const all = await this.findAll();
    return all.filter((k) => k.userId === userId);
  }
}
