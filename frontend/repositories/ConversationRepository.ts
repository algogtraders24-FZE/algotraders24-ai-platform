// repositories/ConversationRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface ConversationEntity extends BaseEntity {
  userId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  // Sprint 15C.7 - optional (not required) so the create-input type
  // (Omit<ConversationEntity, "id"|"createdAt"|"updatedAt">) stays valid at
  // existing call sites, e.g. the Sprint 15C.4 chat route's
  // conversations().create({userId, title, messageCount, lastMessageAt}),
  // which predates this field and is intentionally left untouched. Always
  // populated on reads from Prisma (column has NOT NULL DEFAULT false).
  archived?: boolean;
}

const SEED: ConversationEntity[] = [
  {
    id: "conv_1",
    userId: "u1",
    title: "Market analysis for BTC",
    messageCount: 12,
    lastMessageAt: "2026-07-10T14:30:00.000Z",
    archived: false,
    createdAt: "2026-07-10T13:00:00.000Z",
    updatedAt: "2026-07-10T14:30:00.000Z",
  },
];

export class ConversationRepository extends BaseRepository<ConversationEntity> {
  protected entityName = "conversation";

  constructor() {
    super(SEED);
  }

  async findByUser(userId: string): Promise<ConversationEntity[]> {
    const all = await this.findAll();
    return all.filter((c) => c.userId === userId);
  }
}
