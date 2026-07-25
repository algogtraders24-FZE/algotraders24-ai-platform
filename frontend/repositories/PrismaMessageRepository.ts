// repositories/PrismaMessageRepository.ts
// Sprint 15C.3 - Prisma-backed Message persistence.
// Every read/write is scoped by conversationId AND userId (never by
// conversationId alone) so a mismatched pair simply returns nothing, rather
// than relying solely on the caller to have checked ownership first.
import { prisma } from "@/lib/prisma";
import { RepositoryError, DatabaseConnectionError } from "@/types/repository";
import type {
  MessageEntity,
  NewMessageInput,
  IMessageRepository,
} from "./MessageRepository";

export class PrismaMessageRepository implements IMessageRepository {
  private readonly entityName = "Message";

  private translate(operation: string, error: unknown): RepositoryError {
    if (error instanceof RepositoryError) return error;
    const code = (error as { code?: string })?.code;
    if (code === "P1001" || code === "P1002" || code === "P1017") {
      return new DatabaseConnectionError(this.entityName, operation, error);
    }
    return new RepositoryError({
      code: "UNKNOWN",
      entity: this.entityName,
      operation,
      message: `${this.entityName}.${operation} failed`,
      cause: error,
    });
  }

  async create(input: NewMessageInput): Promise<MessageEntity> {
    try {
      const row = await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          role: input.role,
          content: input.content,
        },
      });
      return row as MessageEntity;
    } catch (error) {
      throw this.translate("create", error);
    }
  }

  async findByConversation(conversationId: string, userId: string): Promise<MessageEntity[]> {
    try {
      const rows = await prisma.message.findMany({
        where: { conversationId, userId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
      return rows as MessageEntity[];
    } catch (error) {
      throw this.translate("findByConversation", error);
    }
  }

  async countByConversation(conversationId: string, userId: string): Promise<number> {
    try {
      return await prisma.message.count({
        where: { conversationId, userId, deletedAt: null },
      });
    } catch (error) {
      throw this.translate("countByConversation", error);
    }
  }
}
