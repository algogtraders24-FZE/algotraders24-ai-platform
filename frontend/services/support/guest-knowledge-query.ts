// services/support/guest-knowledge-query.ts
// AT24 Support - P1 (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS6/SS11/SS14).
//
// This module IS the entire anonymous (guest) support surface. It never
// imports support-account-read.tool.ts, never touches prisma.user /
// subscription / purchase, never reads a session, and never receives a
// userId - there is no code path here that COULD reach account data, not
// just a runtime check that blocks it (SS11 hard rule).
//
// It reuses the SAME retrieval core and coverage thresholds
// support.knowledge_search / supportSpecialist already use for authenticated
// users (CS1), narrowed to visibility:["public"] only - a guest is not a
// customer (R&D SS5.2).
//
// No AgentRun, no AgentStep, no AgentEvidence, no A1-A15 runtime involvement
// at all (P1 D11 SS6): this function runs synchronously, in one request, and
// persists nothing server-side. Continuity across a login is UI-continuity
// only, handled entirely client-side by the widget (SS6/SS12) - there is
// nothing here to merge or claim.

import { searchSupportKnowledge } from "@/services/agent-framework/tools/impl/support-knowledge-search.core";
import {
  SUPPORT_STRONG_MATCH,
  SUPPORT_CITE_BAND,
  MUTATION_MARKERS,
} from "@/services/agent-framework/supervisor/specialists/support.specialist";

// Never "customer" - a guest is not a customer (R&D SS5.2, P1 SS8). Hard-
// coded here, never derived from the request.
const GUEST_VISIBILITIES = ["public"] as const;

// A citation snippet is bounded to keep the guest response small and to
// mirror the existing evidence-claim truncation convention
// (support-knowledge-search.tool.ts's toEvidence, 280 chars) - slightly
// larger here since this IS the visible answer text for a guest (there is no
// persisted AgentEvidence row to look the full passage up from afterwards).
const CITATION_SNIPPET_MAX = 400;

export type GuestCoverage = "kb-answered" | "no-coverage";

export interface GuestCitation {
  topic: string;
  title: string;
  content: string;
  relevance: number;
}

export interface GuestAnswer {
  coverage: GuestCoverage;
  citations: GuestCitation[];
  escalate: boolean;
  escalationReason: string | null;
  disclaimer: string;
}

const DISCLAIMER =
  "Support answer assembled only from the platform's own public support knowledge base. " +
  "Sign in for account-specific help (billing, subscription, licenses). This assistant cannot " +
  "change your account, billing, credits or licenses. Not financial advice.";

function truncate(content: string): string {
  return content.length > CITATION_SNIPPET_MAX ? `${content.slice(0, CITATION_SNIPPET_MAX)}…` : content;
}

/** The entire guest support answer path. Never throws (searchSupportKnowledge
 *  is itself non-throwing) and never returns anything account-shaped - the
 *  return type structurally has no field capable of carrying it. */
export async function answerGuestQuestion(query: string): Promise<GuestAnswer> {
  const trimmed = query.trim();
  const { hits } = await searchSupportKnowledge(trimmed, { visibilities: GUEST_VISIBILITIES });

  const sorted = [...hits].sort((a, b) => b.similarity - a.similarity);
  const bestRelevance = sorted[0]?.similarity ?? 0;
  const kbAnswered = bestRelevance >= SUPPORT_STRONG_MATCH;

  const citations: GuestCitation[] = [];
  if (kbAnswered) {
    const floor = bestRelevance - SUPPORT_CITE_BAND;
    for (const h of sorted) {
      if (h.similarity >= floor) {
        citations.push({ topic: h.topic, title: h.title, content: truncate(h.content), relevance: h.similarity });
      }
    }
  }

  const coverage: GuestCoverage = kbAnswered ? "kb-answered" : "no-coverage";
  const mutationIntent = MUTATION_MARKERS.test(trimmed);
  const escalate = coverage === "no-coverage" || mutationIntent;
  const escalationReason: string | null = !escalate
    ? null
    : mutationIntent
      ? "requires-an-account-change-only-a-human-or-an-authorised-flow-can-make"
      : bestRelevance > 0
        ? "the-support-knowledge-base-had-no-strong-match-for-this-question"
        : "the-support-knowledge-base-did-not-contain-an-answer";

  return {
    coverage,
    citations: citations.slice(0, 12),
    escalate,
    escalationReason,
    disclaimer: DISCLAIMER,
  };
}
