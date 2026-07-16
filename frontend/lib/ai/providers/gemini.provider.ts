// lib/ai/providers/gemini.provider.ts
// Requirement #2/#5/#6: implements AIProvider, no consumer changes,
// normalizes Gemini responses into AICompletionResponse.
import { GoogleGenAI } from "@google/genai";
import type { AIProvider } from "../provider.interface";
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIMessage,
} from "../types";
import { AIProviderError, type AIErrorKind } from "../errors";
import { loadGeminiEnv } from "../env";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const env = loadGeminiEnv();
    this.client = new GoogleGenAI({ apiKey: env.apiKey });
    this.model = env.model;
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();
    try {
      const result = await this.withTimeout(
        this.client.models.generateContent({
          model: req.model ?? this.model,
          contents: this.toGeminiContents(req.messages),
        }),
        DEFAULT_TIMEOUT_MS,
      );

      const usage = result.usageMetadata;
      return {
        content: result.text ?? "",
        model: result.modelVersion ?? req.model ?? this.model,
        provider: this.name,
        latencyMs: Date.now() - started,
        usage: usage
          ? {
              promptTokens: usage.promptTokenCount ?? 0,
              completionTokens: usage.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  // Map our neutral AIMessage[] into Gemini role/parts shape.
  // Gemini uses "model" for assistant + has no dedicated system role,
  // so system messages are folded in as a leading user turn.
  private toGeminiContents(messages: AIMessage[]) {
    return messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AIProviderError("timeout", `Request exceeded ${ms}ms`, this.name),
          ),
        ms,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private normalizeError(err: unknown): AIProviderError {
    if (err instanceof AIProviderError) return err;

    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number })?.status;
    let kind: AIErrorKind = "unknown";

    if (status === 401 || status === 403 || /api key|unauth/i.test(msg)) {
      kind = "auth";
    } else if (status === 429 || /rate.?limit|quota/i.test(msg)) {
      kind = "rate_limit";
    } else if (/network|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
      kind = "network";
    }
    return new AIProviderError(kind, msg, this.name, err);
  }
}
