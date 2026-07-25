// services/ai/conversation-message.service.ts
// Sprint 15C.3 - Business logic for persisting and retrieving conversation
// messages. Prisma details stay in repositories/PrismaMessageRepository.ts;
// this layer validates input, enforces ownership, and preserves chronological
// ordering.
// SECURITY: userId must be session-derived by the caller (see
// lib/auth/protectedRoute.ts) - this service never trusts a client-supplied
// userId as authorization. Every operation re-verifies that conversationId
// belongs to userId in a single scoped query before touching any message,
// mirroring app/api/private/knowledge/ingest/route.ts: a conversation that
// exists but belongs to someone else is indistinguishable from one that does
// not exist at all (NOT_FOUND, never a distinct "forbidden").
import { prisma } from "@/lib/prisma";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import type {
  IMessageRepository,
  MessageEntity,
  MessageRole,
} from "@/repositories/MessageRepository";
import { RepositoryError, EntityNotFoundError } from "@/types/repository";

const VALID_ROLES: readonly MessageRole[] = ["user", "assistant"];

export class ConversationMessageService {
  constructor(
    private readonly repo: IMessageRepository = RepositoryFactory.messages(),
  ) {}

  private assertNonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "Message",
        operation: "validate",
        message: `${field} must be a non-empty string`,
      });
    }
    return value;
  }

  private assertRole(role: unknown): MessageRole {
    if (typeof role !== "string" || !VALID_ROLES.includes(role as MessageRole)) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "Message",
        operation: "validate",
        message: `role must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }
    return role as MessageRole;
  }

  private async assertOwnedConversation(conversationId: string, userId: string): Promise<void> {
    const owned = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) {
      throw new EntityNotFoundError("Conversation", conversationId);
    }
  }

  async addMessage(params: {
    conversationId: string;
    userId: string;
    role: MessageRole;
    content: string;
  }): Promise<MessageEntity> {
    const conversationId = this.assertNonEmpty(params.conversationId, "conversationId");
    const userId = this.assertNonEmpty(params.userId, "userId");
    const role = this.assertRole(params.role);
    const content = this.assertNonEmpty(params.content, "content");

    await this.assertOwnedConversation(conversationId, userId);

    return this.repo.create({ conversationId, userId, role, content });
  }

  async addUserMessage(conversationId: string, userId: string, content: string): Promise<MessageEntity> {
    return this.addMessage({ conversationId, userId, role: "user", content });
  }

  async addAssistantMessage(conversationId: string, userId: string, content: string): Promise<MessageEntity> {
    return this.addMessage({ conversationId, userId, role: "assistant", content });
  }

  /** Chronological (oldest first). Throws EntityNotFoundError if userId does not own conversationId. */
  async getMessages(conversationId: string, userId: string): Promise<MessageEntity[]> {
    const id = this.assertNonEmpty(conversationId, "conversationId");
    const uid = this.assertNonEmpty(userId, "userId");
    await this.assertOwnedConversation(id, uid);
    return this.repo.findByConversation(id, uid);
  }

  async countMessages(conversationId: string, userId: string): Promise<number> {
    const id = this.assertNonEmpty(conversationId, "conversationId");
    const uid = this.assertNonEmpty(userId, "userId");
    await this.assertOwnedConversation(id, uid);
    return this.repo.countByConversation(id, uid);
  }
}
