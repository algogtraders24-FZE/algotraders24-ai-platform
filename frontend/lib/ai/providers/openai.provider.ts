// lib/ai/providers/openai.provider.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Implements the existing, UNMODIFIED AIProvider interface -
// see claude.provider.ts's header for the full "no SDK, real documented
// REST contract, injectable transport, untested against the live API
// this sprint (no real OPENAI_API_KEY exists in this project)" rationale,
// identical here.
import type { AIProvider } from "../provider.interface";
import type { AICompletionRequest, AICompletionResponse } from "../types";
import { AIProviderError, type AIErrorKind } from "../errors";
import { loadOpenAIEnv } from "../env";

const BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network - same convention as ClaudeFetch/AngelOneFetch/BinanceFetch. */
export type OpenAIFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchLikeResponse>;

interface OpenAIChoice {
  message?: { content?: string };
  finish_reason?: string;
}
interface OpenAIResponseBody {
  choices?: OpenAIChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { type?: string; message?: string };
}

export interface OpenAIProviderOptions {
  fetchImpl?: OpenAIFetch;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: OpenAIFetch;

  constructor(options: OpenAIProviderOptions = {}) {
    const env = loadOpenAIEnv();
    this.apiKey = env.apiKey;
    this.model = env.model;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as OpenAIFetch);
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();

    let res: FetchLikeResponse;
    try {
      res = await this.withTimeout(
        this.fetchImpl(BASE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: req.model ?? this.model,
            messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
          }),
        }),
        DEFAULT_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError("network", `Failed to reach OpenAI: ${err instanceof Error ? err.message : String(err)}`, this.name, err);
    }

    if (!res.ok) {
      const kind: AIErrorKind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "invalid_output";
      throw new AIProviderError(kind, `OpenAI returned HTTP ${res.status}`, this.name);
    }

    let body: OpenAIResponseBody;
    try {
      body = (await res.json()) as OpenAIResponseBody;
    } catch {
      throw new AIProviderError("invalid_output", "OpenAI response was not valid JSON", this.name);
    }

    const text = body.choices?.[0]?.message?.content ?? "";
    if (text.trim().length === 0) {
      throw new AIProviderError("invalid_output", "OpenAI response contained no text content", this.name);
    }

    return {
      content: text,
      model: body.model ?? req.model ?? this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
      usage: body.usage ? { promptTokens: body.usage.prompt_tokens ?? 0, completionTokens: body.usage.completion_tokens ?? 0 } : undefined,
    };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AIProviderError("timeout", `Request exceeded ${ms}ms`, this.name)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
