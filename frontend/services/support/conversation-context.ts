// services/support/conversation-context.ts
// AT24 Support - Phase B (Multi-Turn Conversation Continuity).
//
// Pure, DB-free helpers that turn a bounded slice of a SUPPORT conversation's
// prior AgentRun rows into safe text for Phase A's generative fallback
// prompt (services/support/generate-answer.ts). This module never queries
// the database itself - callers pass in already-fetched `{input, output}`
// pairs (agentRunRepository.listRunsForConversation) - and never imports
// services/knowledge-loop/** (INV-1) or anything account-related.
//
// ACCOUNT-DATA ISOLATION (structural, re-affirmed from Phase A, extended to
// conversation history): `summarizeTurnForContext` reads only `run.input`
// (the requester's own past question text) and a fixed, closed set of
// `run.output` fields - `coverage`, `escalationReason`, `citations[].topic`,
// `generatedAnswer`. It NEVER reads `output.accountFindings` or dereferences
// any AgentEvidence row, so an "account-context" prior turn can only ever
// produce a fixed, generic placeholder string here - there is no code path
// through which a prior account finding's claim text could reach a later
// turn's generation prompt. See scripts/validate-support-phase-b.ts for the
// structural + behavioral regression proving this.
//
// BOUNDED WINDOW: only the most recent SUPPORT_CONVERSATION_MAX_TURNS prior
// turns are ever considered, further trimmed (oldest-first) to stay under
// SUPPORT_CONVERSATION_MAX_CHARS - an unbounded transcript is never sent to
// an LLM (constraint from the owner's Phase B brief).

import { MUTATION_ESCALATION_REASON } from "@/services/agent-framework/supervisor/specialists/support.specialist";

/** One prior turn's safe, LLM-promptable summary. */
export interface ConversationTurnSummary {
  question: string;
  answerSummary: string;
}

/** Prior turns considered at most (most recent wins - older turns are
 *  dropped first, both by count and by the char budget below). */
export const SUPPORT_CONVERSATION_MAX_TURNS = 6;

/** Total character budget for the serialized history block. Deliberately
 *  small - this is continuity context, not a transcript replay; Phase A's
 *  own KB reference block is the primary grounding material. */
export const SUPPORT_CONVERSATION_MAX_CHARS = 3000;

const MAX_CONVERSATION_ID_LENGTH = 100;
const CONVERSATION_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

/** Accepts a client-supplied conversationId only if it is a plausible,
 *  well-shaped id - anything else (missing, wrong type, too long, odd
 *  characters) is treated as "start a new conversation" rather than
 *  rejected with an error. There is no security reason to validate more
 *  strictly than this: ownership isolation comes from `userId` scoping in
 *  agentRunRepository.listRunsForConversation, never from the id's shape. */
export function normalizeConversationId(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_CONVERSATION_ID_LENGTH) return null;
  if (!CONVERSATION_ID_SHAPE.test(trimmed)) return null;
  return trimmed;
}

function extractQuestion(input: unknown): string {
  const q = (input as { question?: unknown } | null)?.question;
  return typeof q === "string" ? q.trim() : "";
}

/** Turn one prior SUPPORT run's persisted {input, output} into a safe
 *  {question, answerSummary} pair. Pure - no DB access, no account data. */
export function summarizeTurnForContext(run: { input: unknown; output: unknown }): ConversationTurnSummary {
  const question = extractQuestion(run.input);
  const out = (run.output ?? {}) as {
    coverage?: string;
    escalationReason?: string | null;
    citations?: { topic?: unknown }[];
    generatedAnswer?: unknown;
  };

  let answerSummary: string;
  if (out.coverage === "kb-generated" && typeof out.generatedAnswer === "string" && out.generatedAnswer.trim()) {
    answerSummary = out.generatedAnswer.trim();
  } else if (out.coverage === "kb-answered") {
    const topics = Array.from(
      new Set(
        (out.citations ?? [])
          .map((c) => (typeof c.topic === "string" ? c.topic.trim() : ""))
          .filter((t) => t.length > 0),
      ),
    );
    answerSummary =
      topics.length > 0
        ? `Answered from the AT24 support knowledge base, topics: ${topics.join(", ")}.`
        : "Answered from the AT24 support knowledge base.";
  } else if (out.coverage === "account-context") {
    // Deliberately generic - never the account finding's own domain/claim.
    answerSummary = "Answered using the requester's own account status (not repeated here).";
  } else if (out.escalationReason === MUTATION_ESCALATION_REASON) {
    answerSummary = "This was a request for an account change and was handed off to human support.";
  } else {
    answerSummary = "No answer was found in the support knowledge base; handed off to human support.";
  }

  return { question, answerSummary };
}

/** Apply the bounded-window policy to an already-chronological (oldest
 *  first) list of turn summaries: keep at most the last
 *  SUPPORT_CONVERSATION_MAX_TURNS, then drop further from the OLDEST end
 *  until the total character budget is met - the single most recent turn is
 *  always kept even if it alone exceeds the budget. */
export function buildBoundedContext(turnsChronological: ConversationTurnSummary[]): ConversationTurnSummary[] {
  const recent = turnsChronological.slice(-SUPPORT_CONVERSATION_MAX_TURNS);
  let total = recent.reduce((sum, t) => sum + t.question.length + t.answerSummary.length, 0);
  let start = 0;
  while (total > SUPPORT_CONVERSATION_MAX_CHARS && start < recent.length - 1) {
    total -= recent[start].question.length + recent[start].answerSummary.length;
    start++;
  }
  return recent.slice(start);
}
