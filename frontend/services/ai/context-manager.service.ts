// services/ai/context-manager.service.ts
// Sprint 15C.2 - AI Conversation Context Management Foundation.
//
// Deterministically assembles a bounded Message[] for AIProvider.chat()
// (types/provider.ts) from already-authorized inputs. This module:
//   - does NOT call Gemini or any other provider
//   - does NOT perform vector search or embed anything (RAG stays a caller
//     concern - see repositories/VectorRepository.ts, services/knowledge/*)
//   - does NOT call Google Search
//   - does NOT query the database
//   - does NOT generate a conversation summary
//   - does NOT accept or trust a userId; ownership must already be verified
//     by the caller (conversation + knowledge access checks happen upstream,
//     e.g. app/api/private/knowledge/chat/route.ts) before context assembly
//
// Deterministic ordering (see types/ai-context.ts AIContext.messages):
//   1. system instructions   (never trimmed by size limits)
//   2. conversation summary  (capped at ContextLimits.maxSummaryChars)
//   3. RAG context           (capped at MAX_RAG_CONTEXT_CHARS)
//   4. live search context   (capped at MAX_LIVE_SEARCH_CONTEXT_CHARS)
//   5. recent messages       (chronological, bounded - see below)
//   6. current user message  (always included, never dropped)
//
// Bounding strategy: system instructions, summary, RAG context, live search
// context, and the current user message are treated as required context and
// are never removed once they pass their own per-section cap. Recent
// message history is the only elastic layer: it is first windowed to
// ContextLimits.maxRecentMessages, then - if the assembled context would
// still exceed ContextLimits.maxContextChars - trimmed further by dropping
// the OLDEST messages first, deterministically, until it fits. Chronological
// order of whatever remains is always preserved. Nothing is ever chosen or
// dropped at random or by semantic heuristic.
import type { Message } from "@/types/message";
import type { AIContext, ContextInput, ContextLimits, ContextMeta } from "@/types/ai-context";
import { ContextAssemblyError } from "@/types/ai-context";
import {
  CONTEXT_CONFIG,
  CHARS_PER_TOKEN_ESTIMATE,
  MAX_RAG_CONTEXT_CHARS,
  MAX_LIVE_SEARCH_CONTEXT_CHARS,
} from "@/config/context.config";

/** Rough token estimate (chars / 4), consistent with TextChunker.ts. */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Deterministically window `messages` to at most `maxRecentMessages`,
 * keeping the most recent ones and preserving chronological order.
 * Assumes `messages` is already chronological (oldest first).
 */
export function selectRecentMessages(
  messages: readonly Message[],
  maxRecentMessages: number,
): Message[] {
  if (maxRecentMessages <= 0 || messages.length === 0) return [];
  if (messages.length <= maxRecentMessages) return [...messages];
  return messages.slice(messages.length - maxRecentMessages);
}

/**
 * Keep as many of the newest messages as fit within `charBudget`, dropping
 * the oldest first when over budget. Preserves chronological order.
 */
function trimToCharBudget(messages: readonly Message[], charBudget: number): Message[] {
  if (charBudget <= 0 || messages.length === 0) return [];
  const kept: Message[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = messages[i].content.length;
    if (total + cost > charBudget) break;
    total += cost;
    kept.unshift(messages[i]);
  }
  return kept;
}

function capText(text: string | undefined, maxChars: number): string {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function sumChars(messages: readonly Message[]): number {
  return messages.reduce((total, m) => total + m.content.length, 0);
}

function makeSystemMessage(idSuffix: string, content: string): Message {
  return {
    id: `ctx-${idSuffix}-${Date.now()}`,
    role: "system",
    content,
    createdAt: new Date().toISOString(),
  };
}

function resolveLimits(partial?: Partial<ContextLimits>): ContextLimits {
  const merged: ContextLimits = { ...CONTEXT_CONFIG, ...partial };
  if (!Number.isInteger(merged.maxRecentMessages) || merged.maxRecentMessages < 0) {
    throw new ContextAssemblyError("maxRecentMessages must be a non-negative integer");
  }
  if (!Number.isInteger(merged.maxContextChars) || merged.maxContextChars < 0) {
    throw new ContextAssemblyError("maxContextChars must be a non-negative integer");
  }
  if (!Number.isInteger(merged.maxSummaryChars) || merged.maxSummaryChars < 0) {
    throw new ContextAssemblyError("maxSummaryChars must be a non-negative integer");
  }
  return merged;
}

/**
 * Assemble a bounded, deterministically ordered AIContext from
 * already-authorized inputs. Pure: no I/O, no network, no DB, no logging of
 * message content.
 */
export function buildContext(input: ContextInput): AIContext {
  if (!input?.userMessage || typeof input.userMessage.content !== "string" || input.userMessage.content.trim().length === 0) {
    throw new ContextAssemblyError("userMessage with non-empty content is required");
  }

  const limits = resolveLimits(input.limits);
  const recentMessagesTotal = input.recentMessages?.length ?? 0;

  const systemMessages: Message[] = [];

  // System instructions are required context, not a size-elastic layer -
  // trimmed of whitespace only, never capped by character count.
  const instructions = input.systemInstructions?.trim() ?? "";
  if (instructions) {
    systemMessages.push(makeSystemMessage("system-instructions", instructions));
  }

  const summaryText = capText(input.summary, limits.maxSummaryChars);
  if (summaryText) {
    systemMessages.push(makeSystemMessage("conversation-summary", `Conversation summary:\n${summaryText}`));
  }

  const ragText = capText(input.ragContext, MAX_RAG_CONTEXT_CHARS);
  if (ragText) {
    systemMessages.push(makeSystemMessage("rag-context", `Knowledge base context:\n${ragText}`));
  }

  const searchText = capText(input.liveSearchContext, MAX_LIVE_SEARCH_CONTEXT_CHARS);
  if (searchText) {
    systemMessages.push(makeSystemMessage("live-search-context", `Live search context:\n${searchText}`));
  }

  const fixedChars = sumChars(systemMessages) + input.userMessage.content.length;
  const remainingBudget = Math.max(0, limits.maxContextChars - fixedChars);

  const windowed = selectRecentMessages(input.recentMessages ?? [], limits.maxRecentMessages);
  const recentIncluded = trimToCharBudget(windowed, remainingBudget);

  const messages: Message[] = [...systemMessages, ...recentIncluded, input.userMessage];
  const estimatedChars = sumChars(messages);

  const meta: ContextMeta = {
    recentMessagesTotal,
    recentMessagesIncluded: recentIncluded.length,
    recentMessagesTruncated: recentIncluded.length < recentMessagesTotal,
    summaryIncluded: Boolean(summaryText),
    ragContextIncluded: Boolean(ragText),
    liveSearchContextIncluded: Boolean(searchText),
    estimatedChars,
    estimatedTokens: estimateTokens(estimatedChars),
    charLimit: limits.maxContextChars,
    messageLimit: limits.maxRecentMessages,
  };

  return { messages, meta };
}
