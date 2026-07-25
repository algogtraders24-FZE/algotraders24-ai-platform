// repositories/MessageRepository.ts
// Sprint 15C.3 - Contract for Message persistence (conversation turns).
// Messages are immutable once created (no update operation) and scoped by
// both conversationId and userId on every read/write, mirroring the
// defense-in-depth pattern in repositories/VectorRepository.ts. Ownership
// (does this conversation belong to this user?) is verified one level up,
// in services/ai/conversation-message.service.ts, before this repository
// is ever called.

export type MessageRole = "user" | "assistant";

export interface MessageEntity {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface NewMessageInput {
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
}

export interface IMessageRepository {
  create(input: NewMessageInput): Promise<MessageEntity>;
  /** Chronological (oldest first), scoped to conversationId AND userId. */
  findByConversation(conversationId: string, userId: string): Promise<MessageEntity[]>;
  countByConversation(conversationId: string, userId: string): Promise<number>;
}
