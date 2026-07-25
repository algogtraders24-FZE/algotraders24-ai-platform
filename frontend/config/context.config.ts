// config/context.config.ts
// Sprint 15C.2 - Deterministic bounds for AI conversation context assembly.
// Consumed by services/ai/context-manager.service.ts.
import type { ContextLimits } from "@/types/ai-context";

export const CONTEXT_CONFIG: ContextLimits = {
  maxRecentMessages: 20,
  maxContextChars: 12000,
  maxSummaryChars: 2000,
} as const;

// Defensive per-section caps. RAG/live-search context is expected to arrive
// already bounded by its own producer (e.g. the knowledge chat route caps
// RAG context at 6000 chars today) - these are a second, independent limit
// so the Context Manager never silently forwards unbounded input to a
// provider even if an upstream cap changes or is missing.
export const MAX_RAG_CONTEXT_CHARS = 6000;
export const MAX_LIVE_SEARCH_CONTEXT_CHARS = 4000;

// Rough token estimate, consistent with services/knowledge/TextChunker.ts
// (tokenCount: Math.ceil(chars / 4)). Real tokenization is out of scope.
export const CHARS_PER_TOKEN_ESTIMATE = 4;
