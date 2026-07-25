// services/ai/conversation-lifecycle.service.ts
// Sprint 15C.7 - Server-side conversation lifecycle: archive, unarchive,
// soft-delete. Deliberately separate from ConversationMessageService, which
// stays focused on message turns (addUserMessage/addAssistantMessage/
// getMessages/countMessages) - this operates on the Conversation entity
// itself.
//
// SECURITY: userId must be session-derived by the caller (see
// lib/auth/protectedRoute.ts), never accepted from a request body, query,
// or URL. Every mutation calls the shared assertOwnedConversation (see
// conversation-ownership.service.ts) BEFORE touching the repository - the
// generic RepositoryFactory.conversations().update()/delete() are plain
// CRUD, not userId-scoped, so skipping this check would let any
// authenticated user mutate any conversation by id. A conversation that
// exists but belongs to someone else is indistinguishable from one that
// does not exist (EntityNotFoundError, mapped to 404 by the route).
//
// Soft-delete only: delete() (inherited by PrismaConversationRepository
// from PrismaBaseRepository) sets deletedAt rather than issuing a real SQL
// DELETE, so it never triggers Message's onDelete: Cascade. hardDelete()
// exists on the concrete Prisma repository class but is intentionally not
// part of the IConversationRepository interface this service depends on,
// so it is not reachable from here at all.
import { RepositoryFactory, type IConversationRepository } from "@/repositories/RepositoryFactory";
import { assertOwnedConversation } from "./conversation-ownership.service";
import { RepositoryError } from "@/types/repository";

export class ConversationService {
  constructor(
    private readonly conversations: IConversationRepository = RepositoryFactory.conversations(),
  ) {}

  private assertNonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "Conversation",
        operation: "validate",
        message: `${field} must be a non-empty string`,
      });
    }
    return value;
  }

  private async setArchived(conversationId: string, userId: string, archived: boolean): Promise<void> {
    const id = this.assertNonEmpty(conversationId, "conversationId");
    const uid = this.assertNonEmpty(userId, "userId");
    await assertOwnedConversation(id, uid);
    await this.conversations.update(id, { archived });
  }

  async archiveConversation(conversationId: string, userId: string): Promise<void> {
    await this.setArchived(conversationId, userId, true);
  }

  async unarchiveConversation(conversationId: string, userId: string): Promise<void> {
    await this.setArchived(conversationId, userId, false);
  }

  /** Soft-delete only (sets deletedAt). Message rows are left physically intact but become unreachable via ConversationMessageService, whose ownership check requires deletedAt IS NULL. */
  async softDeleteConversation(conversationId: string, userId: string): Promise<void> {
    const id = this.assertNonEmpty(conversationId, "conversationId");
    const uid = this.assertNonEmpty(userId, "userId");
    await assertOwnedConversation(id, uid);
    await this.conversations.delete(id);
  }
}
