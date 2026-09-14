// services/knowledge-loop/orchestrator/ports.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: orchestrator ports.
// The whole KnowledgeAnswerOrchestrator runs offline against in-memory
// doubles (AN1.9 / K1 / K2 precedent) — `validate:knowledge-loop-orchestrator`
// never opens a DB, never calls an LLM.

import type {
  AIWebSource,
  KnowledgeAnswerProvenanceInput,
  RetrievalOptions,
  RetrievalResult,
} from "@/types/knowledge-loop";

/**
 * The single K1/K2 capability the orchestrator consumes — `KnowledgeService`
 * satisfies it directly. Narrowed to `retrieve` so the offline validator can
 * inject an in-memory double without standing up the whole service.
 *
 * INV-1: this is the ONLY way unapproved knowledge could ever reach an answer,
 * and it cannot — `retrieve()` is the eligibility-filtered, cache-safe path K2
 * hardened; it never reads `KnowledgeCandidate`.
 */
export interface RetrievalPort {
  retrieve(query: string, opts: RetrievalOptions): Promise<RetrievalResult>;
}

/** what a provider slot receives to generate one answer. */
export interface AnswerGenInput {
  /** top-level system instruction(s) (policy + knowledge-loop guardrails). */
  system: string;
  /** the assembled AT24-knowledge context block, or "" when none. */
  knowledgeBlock: string;
  /** prior turns, chronological, already trimmed to the history window. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  /** the orchestrator's web-search gate result — a slot that supports web
   *  search acts on it; others ignore it. */
  webSearchEnabled: boolean;
}

export interface AnswerGenResult {
  text: string;
  /** web sources cited (Claude native web_search). */
  webSources: AIWebSource[];
  /** number of web searches performed. */
  searchCount: number;
  /** did this slot actually run a web search. */
  webSearchUsed: boolean;
  /** web search was requested but the provider reported it unavailable. */
  webSearchUnavailable: boolean;
  /** K3-C §12.4/§12.5 — OPERATIONAL fact: >=1 web-search operation failed this
   *  turn. Non-Claude / non-web slots always `false`. Independent of the
   *  eventual winner and of the evidence-fact `webSearchRequestedButUnavailable`
   *  the orchestrator derives via `buildProvenance`. */
  webSearchFailed: boolean;
  /** diagnostic: some searches failed, >=1 still returned usable results. */
  webSearchPartialFailure: boolean;
  /** number of `pause_turn` continuation POSTs this turn (telemetry). */
  continuationCount: number;
  /** K3-C §12.3/§12.5 — the continuation loop hit its cap and the turn is
   *  STILL paused. A SOFT FAILURE the orchestrator treats as a fall-through
   *  trigger — a paused/placeholder body must never win. */
  continuationBudgetExhausted: boolean;
  /** the terminal `stop_reason` was `max_tokens` — the text may be cut off. */
  truncated: boolean;
  stopReason?: string;
  /** K3-C C8 — cost-relevant token usage, where the underlying provider
   *  surfaces it (`AICompletionResponse.usage`). Undefined, never fabricated,
   *  when the provider doesn't report it. */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * One provider slot in the K3 chain (Claude → Gemini → OpenAI). Same shape as
 * the market-intel `PresenterSlot` but answer-shaped, not envelope-shaped.
 * `isAvailable()` is a cheap synchronous env-presence check — a provider is
 * never constructed for a missing key.
 */
export interface AnswerProviderSlot {
  readonly name: string;
  isAvailable(): boolean;
  generate(input: AnswerGenInput): Promise<AnswerGenResult>;
  /** whether this slot can run Claude-native web search. */
  readonly supportsWebSearch: boolean;
}

export interface ProvenanceStorePort {
  /** best-effort — a write failure never breaks the answer. Returns the row id. */
  write(input: KnowledgeAnswerProvenanceInput): Promise<string | null>;
}
