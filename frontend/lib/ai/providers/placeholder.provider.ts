// lib/ai/providers/placeholder.provider.ts
// Compiles & runs today. Real providers replace this with identical signature.
import type { AIProvider } from "../provider.interface";
import type { AICompletionRequest, AICompletionResponse } from "../types";

export class PlaceholderProvider implements AIProvider {
  readonly name = "placeholder" as const;

  async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    const last = req.messages[req.messages.length - 1]?.content ?? "";
    return {
      content: `[placeholder] echo: ${last}`,
      model: req.model ?? "placeholder-1",
      provider: this.name,
    };
  }
}
