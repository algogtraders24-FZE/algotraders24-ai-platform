// types/ai-context.ts
// Sprint 15C.2 - Context Manager foundation types.
// The Context Manager assembles caller-supplied, already-authorized inputs
// (recent messages, an optional summary, already-built RAG/search context)
// into a bounded, deterministically ordered Message[] ready for
// AIProvider.chat() (see types/provider.ts). It never fetches data itself:
// no DB queries, no vector search, no LLM calls, no web search. Ownership
// (conversation + knowledge) must already be verified by the caller before
// assembly - this layer intentionally has no userId field, so a
// client-supplied id can never masquerade as authorization.
import type { Message } from "./message";

export interface ContextLimits {
  /** Max number of recent conversation messages considered for inclusion. */
  maxRecentMessages: number;
  /** Max total estimated characters across the assembled context. */
  maxContextChars: number;
  /** Max characters kept from an incoming conversation summary. */
  maxSummaryChars: number;
}

export interface ContextInput {
  /** System/persona instructions. Never trimmed by size limits. */
  systemInstructions?: string;
  /** The current turn's user message. Always preserved in the output. */
  userMessage: Message;
  /** Prior turns, oldest first (chronological). Bounded by ContextLimits. */
  recentMessages?: Message[];
  /** Pre-existing conversation summary. This module never generates one. */
  summary?: string;
  /** Already-retrieved RAG context text. This module never performs retrieval. */
  ragContext?: string;
  /** Already-prepared live search context text. This module never searches. */
  liveSearchContext?: string;
  /** Overrides for the default bounds in config/context.config.ts. */
  limits?: Partial<ContextLimits>;
}

export interface ContextMeta {
  recentMessagesTotal: number;
  recentMessagesIncluded: number;
  recentMessagesTruncated: boolean;
  summaryIncluded: boolean;
  ragContextIncluded: boolean;
  liveSearchContextIncluded: boolean;
  estimatedChars: number;
  estimatedTokens: number;
  charLimit: number;
  messageLimit: number;
}

export interface AIContext {
  /**
   * Deterministically ordered messages ready for AIProvider.chat():
   * system instructions -> summary -> RAG context -> live search context
   * -> recent messages (chronological) -> current user message (always last).
   */
  messages: Message[];
  meta: ContextMeta;
}

export class ContextAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextAssemblyError";
  }
}
