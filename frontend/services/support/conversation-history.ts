// services/support/conversation-history.ts
// AT24 Copilot Phase 4 - history and resume. Lists the caller's own Copilot conversations and opens
// one so it can be continued. Conversations are the Phase B `metadata.conversation.id` tags on SUPPORT
// runs; everything here is scoped to the session user's id (never a client value), so another user's
// conversation id simply looks empty.
import { agentRunRepository } from "@/services/agent-framework/runtime/agent-run.repository";
import { getActiveHandoffForUserConversation, type UserFacingHandoff } from "@/services/support/handoff-service";

const MAX_CONVERSATIONS = 20;
const MAX_TURNS_SHOWN = 20;
const TITLE_MAX = 80;

export interface ConversationListItem {
  conversationId: string;
  title: string;
  lastActivityAt: string;
  turns: number;
}

export interface ConversationTurn {
  runId: string;
  question: string;
  /** The written answer, else the generated one, else the strongest cited passage; null if none. */
  answer: string | null;
  coverage: string | null;
  escalate: boolean;
  createdAt: string;
}

export interface ConversationDetail {
  conversationId: string;
  turns: ConversationTurn[];
  handoff: UserFacingHandoff | null;
}

function questionOf(input: unknown): string {
  const q = (input as { question?: unknown } | null)?.question;
  return typeof q === "string" ? q.trim() : "";
}

function conversationIdOf(metadata: unknown): string | null {
  const id = (metadata as { conversation?: { id?: unknown } } | null)?.conversation?.id;
  return typeof id === "string" && id ? id : null;
}

export function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, " ").trim();
  if (!t) return "Conversation";
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

export async function listSupportConversations(userId: string): Promise<ConversationListItem[]> {
  const runs = await agentRunRepository.listSupportRunsForUser(userId, 200); // newest first
  const byConversation = new Map<string, { first: (typeof runs)[number]; last: (typeof runs)[number]; turns: number }>();
  for (const r of runs) {
    const id = conversationIdOf(r.metadata);
    if (!id) continue;
    const entry = byConversation.get(id);
    if (!entry) byConversation.set(id, { first: r, last: r, turns: 1 });
    else {
      entry.first = r; // runs are newest-first, so the last one visited is the oldest
      entry.turns += 1;
    }
  }
  return [...byConversation.entries()]
    .map(([conversationId, e]) => ({
      conversationId,
      title: titleFrom(questionOf(e.first.input)),
      lastActivityAt: e.last.createdAt.toISOString(),
      turns: e.turns,
    }))
    .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
    .slice(0, MAX_CONVERSATIONS);
}

/** The caller's own conversation, oldest turn first, or null when it has no runs for this user. */
export async function getSupportConversation(userId: string, conversationId: string): Promise<ConversationDetail | null> {
  const runs = await agentRunRepository.listRunsForConversation(userId, conversationId, MAX_TURNS_SHOWN);
  if (runs.length === 0) return null;

  const turns = await Promise.all(
    runs.map(async (r): Promise<ConversationTurn> => {
      const out = (r.output ?? {}) as {
        coverage?: string;
        escalate?: boolean;
        composedAnswer?: unknown;
        generatedAnswer?: unknown;
        citations?: { evidenceId?: unknown }[];
      };
      let answer: string | null = null;
      if (typeof out.composedAnswer === "string" && out.composedAnswer.trim()) answer = out.composedAnswer.trim();
      else if (typeof out.generatedAnswer === "string" && out.generatedAnswer.trim()) answer = out.generatedAnswer.trim();
      else if (out.coverage === "kb-answered" && Array.isArray(out.citations) && out.citations.length > 0) {
        const wanted = out.citations[0]?.evidenceId;
        const trace = await agentRunRepository.getRunTrace(r.id);
        const ev = trace.evidence.find((e) => e.id === wanted);
        if (ev) answer = ev.claim;
      }
      return {
        runId: r.id,
        question: questionOf(r.input),
        answer,
        coverage: out.coverage ?? null,
        escalate: out.escalate === true,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  );

  const handoff = await getActiveHandoffForUserConversation(userId, conversationId).catch(() => null);
  return { conversationId, turns, handoff };
}
