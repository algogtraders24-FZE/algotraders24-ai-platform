// services/ai/conversation-ownership.service.ts
// Sprint 15C.7 - Shared ownership assertion for the Conversation entity.
// Extracted from services/ai/conversation-message.service.ts's former
// private assertOwnedConversation so every service that mutates or reads a
// single conversation (ConversationMessageService for turns,
// ConversationService for lifecycle) enforces ownership identically,
// instead of each keeping its own ad-hoc copy of the check.
//
// SECURITY: userId must be session-derived by the caller (see
// lib/auth/protectedRoute.ts) - never a client-supplied value. A
// conversation that exists but belongs to someone else is indistinguishable
// from one that does not exist at all: both throw EntityNotFoundError
// (mapped to 404, never a distinct "forbidden", by every route that calls
// this - see app/api/private/knowledge/ingest/route.ts for the original
// precedent).
import { prisma } from "@/lib/prisma";
import { EntityNotFoundError } from "@/types/repository";

export async function assertOwnedConversation(conversationId: string, userId: string): Promise<void> {
  const owned = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    throw new EntityNotFoundError("Conversation", conversationId);
  }
}
