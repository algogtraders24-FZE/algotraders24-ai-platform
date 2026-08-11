// lib/ai/providers/claude.provider.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Implements the existing, UNMODIFIED AIProvider interface -
// a drop-in for GeminiIntelligencePresenter (D2.6.5) or the new
// AIPresenterOrchestratorService, exactly like GeminiProvider.
//
// No @anthropic-ai/sdk dependency - built as a real, documented REST
// contract call (Anthropic's Messages API) via an injectable fetch, the
// same "no SDK, injectable transport" pattern already established for
// lib/market-data/providers/angel-one.provider.ts and binance.provider.ts.
// No real ANTHROPIC_API_KEY exists in this project - untested against
// the live API this sprint (see this file's own header discipline,
// matching AngelOneProvider's identical, explicit live-verification
// status note); tested only against fake/injected HTTP responses
// matching the documented contract.
import type { AIProvider } from "../provider.interface";
import type { AICompletionRequest, AICompletionResponse, AIMessage } from "../types";
import { AIProviderError, type AIErrorKind } from "../errors";
import { loadAnthropicEnv } from "../env";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network - same convention as AngelOneFetch/BinanceFetch. */
export type ClaudeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchLikeResponse>;

interface ClaudeContentBlock {
  type: string;
  text?: string;
}
interface ClaudeResponseBody {
  content?: ClaudeContentBlock[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

export interface ClaudeProviderOptions {
  fetchImpl?: ClaudeFetch;
}

export class ClaudeProvider implements AIProvider {
  readonly name = "claude" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: ClaudeFetch;

  constructor(options: ClaudeProviderOptions = {}) {
    const env = loadAnthropicEnv();
    this.apiKey = env.apiKey;
    this.model = env.model;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as ClaudeFetch);
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();
    const { system, messages } = this.splitSystem(req.messages);

    let res: FetchLikeResponse;
    try {
      res = await this.withTimeout(
        this.fetchImpl(BASE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION },
          body: JSON.stringify({
            model: req.model ?? this.model,
            max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(system ? { system } : {}),
            messages,
          }),
        }),
        DEFAULT_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError("network", `Failed to reach Claude: ${err instanceof Error ? err.message : String(err)}`, this.name, err);
    }

    if (!res.ok) {
      const kind: AIErrorKind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "invalid_output";
      throw new AIProviderError(kind, `Claude returned HTTP ${res.status}`, this.name);
    }

    let body: ClaudeResponseBody;
    try {
      body = (await res.json()) as ClaudeResponseBody;
    } catch {
      throw new AIProviderError("invalid_output", "Claude response was not valid JSON", this.name);
    }

    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text.trim().length === 0) {
      throw new AIProviderError("invalid_output", "Claude response contained no text content", this.name);
    }

    return {
      content: text,
      model: body.model ?? req.model ?? this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
      usage: body.usage ? { promptTokens: body.usage.input_tokens ?? 0, completionTokens: body.usage.output_tokens ?? 0 } : undefined,
    };
  }

  // Anthropic's Messages API has a dedicated top-level `system` field, not
  // a "system" role inside `messages` - unlike Gemini/OpenAI's own
  // conventions. Every system-role AIMessage is folded into that field;
  // never silently dropped.
  private splitSystem(messages: AIMessage[]): { system?: string; messages: { role: "user" | "assistant"; content: string }[] } {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content }));
    return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, messages: rest };
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
