// lib/ai/ai.service.ts
// SRP - orchestrates: load history -> call provider -> persist.
// Provider & persistence injected (constructor DI). No provider lock-in.
import type { AIProvider } from "./provider.interface";
import type { ConversationPort } from "./ports";
import type { AICompletionResponse } from "./types";

export class AIService {
  constructor(
    private readonly provider: AIProvider,
    private readonly conversations: ConversationPort,
  ) {}

  async send(
    conversationId: string,
    userText: string,
  ): Promise<AICompletionResponse> {
    const history = await this.conversations.loadHistory(conversationId);
    const messages = [...history, { role: "user" as const, content: userText }];

    const res = await this.provider.complete({ messages });

    await this.conversations.appendTurn(conversationId, {
      role: "user",
      content: userText,
    });
    await this.conversations.appendTurn(conversationId, {
      role: "assistant",
      content: res.content,
    });
    return res;
  }
}
