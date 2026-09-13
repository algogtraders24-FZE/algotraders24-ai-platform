// lib/ai/providers/claude.provider.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Implements the existing, UNMODIFIED AIProvider interface -
// a drop-in for GeminiIntelligencePresenter (D2.6.5) or the new
// AIPresenterOrchestratorService, exactly like GeminiProvider.
//
// No @anthropic-ai/sdk dependency - a real, documented REST contract call
// (Anthropic's Messages API) via an injectable fetch, the same "no SDK,
// injectable transport" pattern already established for
// lib/market-data/providers/angel-one.provider.ts and binance.provider.ts.
// K1_DECISION SO-1 re-locked this ("REST, no @anthropic-ai/sdk, injectable
// fetch"). Tested against fake/injected HTTP responses matching the
// documented contract (scripts/validate-knowledge-loop-claude-provider.ts).
//
// Sprint K3 (K3_PREFLIGHT §1.2, §4.1) - ADDITIVE native web search. When
// `req.tools` contains a `web_search` spec, the request carries Anthropic's
// `web_search_20250305` server tool and this provider:
//   - parses `server_tool_use` + `web_search_tool_result` content blocks
//   - collects `web_search_result_location` citations onto `webSources`
//     (with each result's `encrypted_content` for multi-turn continuation)
//   - runs the `stop_reason: "pause_turn"` continuation loop (resend the
//     paused assistant turn verbatim; capped)
//   - treats an HTTP-200 `web_search_tool_result_error` as "search
//     unavailable" (webSearchUnavailable = true), NEVER a thrown error - the
//     answer then comes from the model's own knowledge.
// A request that omits `tools` is byte-identical to the pre-K3 behaviour.
import type { AIProvider } from "../provider.interface";
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIMessage,
  AIToolSpec,
  AIWebSource,
} from "../types";
import { AIProviderError, type AIErrorKind } from "../errors";
import { loadAnthropicEnv } from "../env";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 30_000;
/** web-search turns run a server-side loop + fetch pages - allow longer. */
const WEB_SEARCH_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 2048;
/** K3_PREFLIGHT §1.2 - cap the pause_turn continuation loop. */
const MAX_WEB_SEARCH_CONTINUATIONS = 3;

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Narrow transport contract so a test can inject a controlled double instead of the real network - same convention as AngelOneFetch/BinanceFetch. */
export type ClaudeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchLikeResponse>;

// ── Anthropic response block shapes (only the fields this provider reads) ──
interface CitationBlock {
  type: string;
  url?: string;
  title?: string;
  cited_text?: string;
}
interface WebSearchResultItem {
  type: string; // "web_search_result"
  url?: string;
  title?: string;
  page_age?: string;
  encrypted_content?: string;
}
interface WebSearchToolResultError {
  type: string; // "web_search_tool_result_error"
  error_code?: string;
}
interface ClaudeContentBlock {
  type: string;
  text?: string;
  citations?: CitationBlock[];
  // web_search_tool_result: content is a list on success, an error object on failure
  content?: WebSearchResultItem[] | WebSearchToolResultError;
}
interface ClaudeResponseBody {
  content?: ClaudeContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  error?: { type?: string; message?: string };
}

type WireMessage = { role: "user" | "assistant"; content: string | unknown[] };

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
    const anthropicTools = this.buildTools(req.tools);
    const wantsTools = anthropicTools.length > 0;
    const timeoutMs = wantsTools ? WEB_SEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    const bodyBase: Record<string, unknown> = {
      model: req.model ?? this.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(system ? { system } : {}),
      ...(wantsTools ? { tools: anthropicTools } : {}),
    };

    const convo: WireMessage[] = [...messages];
    let body: ClaudeResponseBody | undefined;
    let searchCount = 0;
    let webSearchUnavailable = false;
    const sources = new Map<string, AIWebSource>();

    // Single POST for the no-tools path; a bounded pause_turn loop for tools.
    for (let attempt = 0; attempt <= MAX_WEB_SEARCH_CONTINUATIONS; attempt += 1) {
      const res = await this.post({ ...bodyBase, messages: convo }, timeoutMs);
      body = await this.readBody(res);

      const parsed = this.scanBlocks(body.content ?? []);
      searchCount += parsed.searchRequests;
      if (parsed.searchUnavailable) webSearchUnavailable = true;
      for (const s of parsed.sources) this.mergeSource(sources, s);

      if (body.stop_reason !== "pause_turn") break;
      // resume: append the paused assistant turn VERBATIM (blocks incl.
      // encrypted_content) and re-POST - the server detects the trailing
      // server_tool_use and continues on its own.
      convo.push({ role: "assistant", content: body.content ?? [] });
    }

    if (!body) {
      throw new AIProviderError("invalid_output", "Claude returned no response body", this.name);
    }
    // account for the search count the API reports in usage (may include the
    // final turn not surfaced as a separate block)
    if (body.usage?.server_tool_use?.web_search_requests !== undefined) {
      searchCount = Math.max(searchCount, body.usage.server_tool_use.web_search_requests);
    }

    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text.trim().length === 0) {
      throw new AIProviderError("invalid_output", "Claude response contained no text content", this.name);
    }

    const webSources = [...sources.values()];
    return {
      content: text,
      model: body.model ?? req.model ?? this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
      usage: body.usage
        ? { promptTokens: body.usage.input_tokens ?? 0, completionTokens: body.usage.output_tokens ?? 0 }
        : undefined,
      stopReason: body.stop_reason,
      ...(wantsTools ? { webSources, searchCount, webSearchUnavailable } : {}),
    };
  }

  // ── request helpers ────────────────────────────────────────────────
  private async post(
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<FetchLikeResponse> {
    let res: FetchLikeResponse;
    try {
      res = await this.withTimeout(
        this.fetchImpl(BASE_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
        }),
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(
        "network",
        `Failed to reach Claude: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }
    if (!res.ok) {
      const kind: AIErrorKind =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 429
            ? "rate_limit"
            : "invalid_output";
      throw new AIProviderError(kind, `Claude returned HTTP ${res.status}`, this.name);
    }
    return res;
  }

  private async readBody(res: FetchLikeResponse): Promise<ClaudeResponseBody> {
    try {
      return (await res.json()) as ClaudeResponseBody;
    } catch {
      throw new AIProviderError("invalid_output", "Claude response was not valid JSON", this.name);
    }
  }

  // K3_PREFLIGHT §1.2 - `web_search_20250305` (basic, every model, direct
  // caller - no code-execution environment). Dynamic filtering
  // (`web_search_20260209`) is a later optimisation, out of K3-B scope.
  private buildTools(tools?: AIToolSpec[]): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const t of tools ?? []) {
      if (t.kind === "web_search") {
        const spec: Record<string, unknown> = {
          type: "web_search_20250305",
          name: "web_search",
        };
        if (t.maxUses !== undefined) spec.max_uses = t.maxUses;
        if (t.allowedDomains?.length) spec.allowed_domains = t.allowedDomains;
        else if (t.blockedDomains?.length) spec.blocked_domains = t.blockedDomains;
        if (t.userLocation) {
          spec.user_location = {
            type: "approximate",
            ...(t.userLocation.city ? { city: t.userLocation.city } : {}),
            ...(t.userLocation.region ? { region: t.userLocation.region } : {}),
            ...(t.userLocation.country ? { country: t.userLocation.country } : {}),
            ...(t.userLocation.timezone ? { timezone: t.userLocation.timezone } : {}),
          };
        }
        out.push(spec);
      }
    }
    return out;
  }

  // ── response parsing ───────────────────────────────────────────────
  private scanBlocks(blocks: ClaudeContentBlock[]): {
    searchRequests: number;
    searchUnavailable: boolean;
    sources: AIWebSource[];
  } {
    let searchRequests = 0;
    let searchUnavailable = false;
    const sources: AIWebSource[] = [];

    for (const b of blocks) {
      if (b.type === "server_tool_use") {
        searchRequests += 1;
        continue;
      }
      if (b.type === "web_search_tool_result") {
        const c = b.content;
        if (Array.isArray(c)) {
          for (const r of c) {
            if (r.type === "web_search_result" && typeof r.url === "string") {
              sources.push({
                url: r.url,
                title: r.title ?? r.url,
                pageAge: r.page_age,
                encryptedContent: r.encrypted_content,
                citedTexts: [],
              });
            }
          }
        } else if (c && (c as WebSearchToolResultError).type === "web_search_tool_result_error") {
          // HTTP 200 error block - NOT a thrown error. The model answers from
          // its own knowledge; the orchestrator records webSearchUnavailable.
          searchUnavailable = true;
        }
        continue;
      }
      if (b.type === "text" && Array.isArray(b.citations)) {
        for (const cit of b.citations) {
          if (
            cit.type === "web_search_result_location" &&
            typeof cit.url === "string" &&
            typeof cit.cited_text === "string"
          ) {
            sources.push({
              url: cit.url,
              title: cit.title ?? cit.url,
              citedTexts: [cit.cited_text],
            });
          }
        }
      }
    }
    return { searchRequests, searchUnavailable, sources };
  }

  private mergeSource(map: Map<string, AIWebSource>, s: AIWebSource): void {
    const existing = map.get(s.url);
    if (!existing) {
      map.set(s.url, { ...s, citedTexts: [...s.citedTexts] });
      return;
    }
    if (!existing.encryptedContent && s.encryptedContent) existing.encryptedContent = s.encryptedContent;
    if (!existing.pageAge && s.pageAge) existing.pageAge = s.pageAge;
    if ((!existing.title || existing.title === existing.url) && s.title && s.title !== s.url) {
      existing.title = s.title;
    }
    for (const t of s.citedTexts) {
      if (t && !existing.citedTexts.includes(t)) existing.citedTexts.push(t);
    }
  }

  // Anthropic's Messages API has a dedicated top-level `system` field, not
  // a "system" role inside `messages` - unlike Gemini/OpenAI's own
  // conventions. Every system-role AIMessage is folded into that field;
  // never silently dropped.
  private splitSystem(messages: AIMessage[]): {
    system?: string;
    messages: WireMessage[];
  } {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const rest: WireMessage[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));
    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: rest,
    };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AIProviderError("timeout", `Request exceeded ${ms}ms`, this.name)),
        ms,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
