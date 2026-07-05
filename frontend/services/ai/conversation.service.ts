// services/ai/conversation.service.ts
import type { Conversation, ConversationSummary } from "@/types/conversation";
import type { Message } from "@/types/message";
import { mockConversations } from "@/data/mock-conversations";

export function getConversations(): Conversation[] {
  return mockConversations;
}

export function getConversationSummaries(): ConversationSummary[] {
  return mockConversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

export function getConversationById(id: string): Conversation | undefined {
  return mockConversations.find((c) => c.id === id);
}

export function appendMessage(conversation: Conversation, message: Message): Conversation {
  return { ...conversation, messages: [...conversation.messages, message], updatedAt: message.createdAt };
}