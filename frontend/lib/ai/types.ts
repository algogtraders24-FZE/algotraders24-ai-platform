// lib/ai/types.ts
// SOLID: ISP - narrow, role-specific interfaces. No provider imports here.
export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIRole;
  content: string;
}

// Sprint K3 — provider-neutral server-tool spec. Additive: a request that
// omits `tools` is byte-identical to pre-K3 behaviour on every provider.
// Only ClaudeProvider acts on it (Anthropic's native web_search server tool,
// K1_DECISION SO-1); Gemini/OpenAI/Placeholder ignore it.
export interface AIWebSearchTool {
  kind: "web_search";
  /** cap on searches per turn (Anthropic `max_uses`). */
  maxUses?: number;
  /** allow-list OR block-list (never both) — bare hostnames, no scheme. */
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** localize results (Anthropic `user_location`). */
  userLocation?: {
    city?: string;
    region?: string;
    /** ISO 3166-1 alpha-2. */
    country?: string;
    /** IANA tz id. */
    timezone?: string;
  };
}
export type AIToolSpec = AIWebSearchTool;

/** A web source Claude cited while using the native web_search tool. */
export interface AIWebSource {
  url: string;
  title: string;
  /** Anthropic `page_age`, e.g. "April 30, 2025". */
  pageAge?: string;
  /** Anthropic `encrypted_content` — opaque; must be echoed back verbatim on
   *  any multi-turn continuation. */
  encryptedContent?: string;
  /** the `cited_text` snippets (≤150 chars each) Claude attributed to this URL. */
  citedTexts: string[];
}

export interface AICompletionRequest {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Sprint K3 — server tools. Currently only `web_search` (ClaudeProvider). */
  tools?: AIToolSpec[];
}

export interface AICompletionResponse {
  content: string;
  model: string;
  provider: string;
  // Requirement #8: expose usage + latency through the service layer.
  // Optional so existing PlaceholderProvider stays valid (no breaking change).
  usage?: { promptTokens: number; completionTokens: number };
  latencyMs?: number;
  // Sprint K3 — set only when a server tool ran.
  /** web sources Claude cited (native web_search). Empty/undefined otherwise. */
  webSources?: AIWebSource[];
  /** number of native web searches Claude performed this turn. */
  searchCount?: number;
  /** the provider's terminal stop reason (e.g. "end_turn", "max_tokens"). */
  stopReason?: string;
  /** true when the terminal `stop_reason` was `max_tokens` — the answer is
   *  cut off, not a normal completion. Observable to the orchestrator so a
   *  truncated answer can be recorded (K3-C C1 / §12.5). */
  truncated?: boolean;
  /** true iff a web search was requested this turn and NONE returned a usable
   *  (non-empty) result list — every search errored, returned nothing, or a
   *  mix. The answer then came from the model's own knowledge, never
   *  fabricated. (§12.5) */
  webSearchUnavailable?: boolean;
  /** K3-C §12.4 — OPERATIONAL fact: ≥ 1 web-search *operation* failed this turn
   *  (an error block or an unrecognised tool-result shape). A search that ran
   *  fine but returned zero matches is NOT a failure. Independent of which
   *  provider ultimately won — the orchestrator computes the separate
   *  evidence-fact `webSearchRequestedButUnavailable`. */
  webSearchFailed?: boolean;
  /** K3-C §12.4 — diagnostic: `searchErrors > 0 && searchResultsOk > 0`
   *  (some searches failed, at least one still returned usable results). */
  webSearchPartialFailure?: boolean;
  /** K3-C §12.5 — number of `pause_turn` continuation POSTs made this turn. */
  continuationCount?: number;
  /** K3-C §12.5 — true when the `pause_turn` continuation loop hit its cap and
   *  the turn is STILL paused. A SOFT failure: the orchestrator abandons this
   *  slot (a paused/placeholder body must never win — §12.3). */
  continuationBudgetExhausted?: boolean;
}

export type AIProviderName =
  | "gemini"
  | "openai"
  | "claude"
  | "deepseek"
  | "placeholder";
