// repositories/PrismaConversationRepository.ts
// Sprint 14D - Prisma-backed ConversationRepository.
import type { ConversationEntity } from "./ConversationRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Conversation as PrismaConversation } from "@/lib/generated/prisma/client";

export class PrismaConversationRepository extends PrismaBaseRepository<ConversationEntity, PrismaConversation> {
  protected entityName = "Conversation";
  protected delegate = prisma.conversation as unknown as PrismaDelegate;

  protected toEntity(row: PrismaConversation): ConversationEntity {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      messageCount: row.messageCount,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<ConversationEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      title: input.title,
      messageCount: input.messageCount,
      lastMessageAt: new Date(input.lastMessageAt),
    };
  }

  protected toUpdateData(patch: Partial<Omit<ConversationEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      userId: patch.userId ?? undefined,
      title: patch.title ?? undefined,
      messageCount: patch.messageCount ?? undefined,
      lastMessageAt: patch.lastMessageAt ? new Date(patch.lastMessageAt) : undefined,
    };
  }

  async findByUser(userId: string): Promise<ConversationEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({ where: { userId, deletedAt: null }, orderBy: { lastMessageAt: "desc" } })) as PrismaConversation[];
      return rows.map((r) => this.toEntity(r));
    });
  }
}
