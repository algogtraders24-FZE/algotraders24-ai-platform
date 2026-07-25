// services/ai/conversation-message.service.ts
// Sprint 15C.3 - Business logic for persisting and retrieving conversation
// messages. Prisma details stay in repositories/PrismaMessageRepository.ts;
// this layer validates input, enforces ownership, and preserves chronological
// ordering.
// SECURITY: userId must be session-derived by the caller (see
// lib/auth/protectedRoute.ts) - this service never trusts a client-supplied
// userId as authorization. Every operation re-verifies that conversationId
// belongs to userId before touching any message, mirroring
// app/api/private/knowledge/ingest/route.ts: a conversation that exists but
// belongs to someone else is indistinguishable from one that does not exist
// at all (NOT_FOUND, never a distinct "forbidden").
// Sprint 15C.7 - the ownership check itself now lives in
// conversation-ownership.service.ts, shared with ConversationService
// (conversation-lifecycle.service.ts) so both enforce it identically.
import { RepositoryFactory, type IConversationRepository } from "@/repositories/RepositoryFactory";
import type {
  IMessageRepository,
  MessageEntity,
  MessageRole,
} from "@/repositories/MessageRepository";
import { RepositoryError } from "@/types/repository";
import type { Message } from "@/types/message";
import { assertOwnedConversation } from "./conversation-ownership.service";

const VALID_ROLES: readonly MessageRole[] = ["user", "assistant"];

/** Converts a persisted row into the shape services/ai/context-manager.service.ts expects. */
export function toMessage(entity: MessageEntity): Message {
  return {
    id: entity.id,
    role: entity.role,
    content: entity.content,
    createdAt: entity.createdAt.toISOString(),
  };
}

export class ConversationMessageService {
  constructor(
    private readonly repo: IMessageRepository = RepositoryFactory.messages(),
    private readonly conversations: IConversationRepository = RepositoryFactory.conversations(),
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

    await assertOwnedConversation(conversationId, userId);

    const created = await this.repo.create({ conversationId, userId, role, content });
    await this.touchConversation(conversationId, userId);
    return created;
  }

  // Sprint 15C.4 - keep Conversation.messageCount/lastMessageAt current now
  // that messages are actually persisted. Best-effort: a metadata refresh
  // failure must not undo an already-persisted message, so it is swallowed
  // rather than thrown.
  private async touchConversation(conversationId: string, userId: string): Promise<void> {
    try {
      const messageCount = await this.repo.countByConversation(conversationId, userId);
      await this.conversations.update(conversationId, {
        messageCount,
        lastMessageAt: new Date().toISOString(),
      });
    } catch {
      // Non-critical: the message row is the source of truth.
    }
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
    await assertOwnedConversation(id, uid);
    return this.repo.findByConversation(id, uid);
  }

  async countMessages(conversationId: string, userId: string): Promise<number> {
    const id = this.assertNonEmpty(conversationId, "conversationId");
    const uid = this.assertNonEmpty(userId, "userId");
    await assertOwnedConversation(id, uid);
    return this.repo.countByConversation(id, uid);
  }
}
