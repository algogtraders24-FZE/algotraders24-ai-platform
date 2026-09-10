// services/agent-framework/supervisor/specialists/support.specialist.ts
// AT24 Agent Framework - CS1. The Support specialist.
//
// PLAN: the governed platform support corpus first (scope=support, always).
// Then - ONLY when the question is about the requester's own account (billing
// / credits / subscription / purchase / license) - the read-only account
// status tool.
//
// SYNTHESIS: a deterministic, EVIDENCE-FIRST support answer. Exactly the A11
// citation discipline:
//   - the output NEVER contains the support passage text or a generated prose
//     answer - only typed CITATIONS (evidenceId + topic + source +
//     relevance). The passage text lives in the immutable AgentEvidence row,
//     where the A6 integrity gate verifies its lineage. This is also what
//     lets a support answer whose source passage legitimately contains the
//     word "buy" / "sell" pass the A6 signal-language gate.
//   - the raw user question is NEVER echoed into a scanned string field
//     (strategy-research.specialist's rule) - a support question can itself
//     contain "buy" / "sell".
//   - NO LLM. The "synthesis" is coverage + ranking + an escalation decision.
//
// ESCALATION (CS1.2 D5): when the knowledge base does not resolve the
// question, OR the question is a request for an account change (which this
// read-only agent can never make), the answer sets escalate:true with a
// fixed, safe reason string - a structured hand-off to human support.

import type { AgentDefinition } from "@/types/agent-framework";
import type { ParsedGoal } from "../goal";
import type { Specialist, SpecialistPlan } from "../specialist";
import type { RunTrace, RunSynthesis } from "../run-planner";

const KB_TOOL = "support.knowledge_search";
const ACCOUNT_TOOL = "support.account_read";

// The question is "about my account" when it mentions account-state nouns.
const ACCOUNT_MARKERS =
  /\b(bill(ing|ed)?|invoice|receipt|charge|credit|credits|subscription|subscribe[d]?|plan|renew(al|ed)?|purchase[d]?|order|licen[cs]e[d]?|activation|entitlement|refund)\b/i;

// The question is a request for a CHANGE only a human/authorised flow can make.
const MUTATION_MARKERS =
  /\b(cancel|refund|reactivate|re-?enable|downgrade|upgrade|change (my )?(plan|card|email)|reset (my )?password|delete (my )?account|transfer|revoke|dispute|chargeback|deactivate)\b/i;

type Coverage = "kb-answered" | "account-context" | "no-coverage";

// The support tool already dropped noise (< 0.45). On top of that, only
// treat the corpus as having ANSWERED when a hit is a genuinely strong
// match - otherwise it is `no-coverage` and the agent escalates (CS1.2 D5).
// `SUPPORT_STRONG_MATCH` and the citation band are deliberately conservative:
// a weak, tangentially-related passage is worse than an honest hand-off.
const SUPPORT_STRONG_MATCH = 0.6;
const SUPPORT_CITE_BAND = 0.1;

interface Citation {
  evidenceId: string;
  /** knowledgeType / category of the cited support row (faq | support | policy | product | ...). */
  topic: string;
  source: string;
  relevance: number;
  confidence: number;
}

interface AccountFinding {
  evidenceId: string;
  domain: string;
}

export const supportSpecialist: Specialist = {
  key: "SUPPORT",

  planTools(_definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan {
    const wantsAccount = ACCOUNT_MARKERS.test(goal.question);
    const ordered: string[] = [];
    if (boundToolIds.includes(KB_TOOL)) ordered.push(KB_TOOL);
    // support.account_read is invoked ONLY for an account-scoped question -
    // never speculatively (it reads the requester's billing records).
    if (wantsAccount && boundToolIds.includes(ACCOUNT_TOOL)) ordered.push(ACCOUNT_TOOL);
    // any OTHER bound tool (a future addition) after the known order - the two
    // known support tools are placed by the rules above, never here.
    const known = new Set([KB_TOOL, ACCOUNT_TOOL]);
    for (const id of boundToolIds) if (!known.has(id) && !ordered.includes(id)) ordered.push(id);

    const requests = ordered.map((toolId) => ({
      toolId,
      input: shapeSupportInput(toolId, goal),
      rationale:
        toolId === KB_TOOL
          ? "search the platform-owned support knowledge base for material answering the question"
          : toolId === ACCOUNT_TOOL
            ? "read the requester's own plan / subscription / purchase / license status for an account-aware answer"
            : `bound tool "${toolId}"`,
    }));

    return {
      requests,
      rationale: `support plan: ${ordered.join(" -> ")} -> evidence-first cited answer + escalation decision`,
    };
  },

  synthesize(trace: RunTrace, _definition: AgentDefinition, goal: ParsedGoal): RunSynthesis {
    const citations: Citation[] = [];
    const accountFindings: AccountFinding[] = [];
    const topics = new Set<string>();

    // CS1.2 D2: evidence.type reuses AgentEvidenceType values already in the
    // Postgres enum ("research_document" for support-KB, "derived" for
    // account status). The support-vs-other discriminator is the `source`
    // prefix that the two support tools stamp - never a new enum value.
    const allKbHits: Citation[] = [];
    for (const e of trace.evidence) {
      if (e.source.startsWith("support-kb:")) {
        const topic = readTopic(e);
        allKbHits.push({
          evidenceId: e.id,
          topic,
          source: e.source,
          relevance: e.relevance,
          confidence: e.confidence,
        });
      } else if (e.source.startsWith("account:")) {
        accountFindings.push({ evidenceId: e.id, domain: readDomain(e) });
      }
    }
    allKbHits.sort((a, b) => b.relevance - a.relevance);

    // ANSWERED only on a strong match; then cite the strongest hit plus any
    // within SUPPORT_CITE_BAND of it (a weak tail is dropped, not cited).
    const bestRelevance = allKbHits[0]?.relevance ?? 0;
    const kbAnswered = bestRelevance >= SUPPORT_STRONG_MATCH;
    if (kbAnswered) {
      const floor = bestRelevance - SUPPORT_CITE_BAND;
      for (const c of allKbHits) {
        if (c.relevance >= floor) {
          citations.push(c);
          topics.add(c.topic);
        }
      }
    }

    const hasAccountContext = accountFindings.length > 0;
    const coverage: Coverage = kbAnswered ? "kb-answered" : hasAccountContext ? "account-context" : "no-coverage";
    const resolved = coverage !== "no-coverage";

    const mutationIntent = MUTATION_MARKERS.test(goal.question);
    const escalate = !resolved || mutationIntent;
    const escalationReason: string | null = !escalate
      ? null
      : mutationIntent
        ? "requires-an-account-change-only-a-human-or-an-authorised-flow-can-make"
        : bestRelevance > 0
          ? "the-support-knowledge-base-had-no-strong-match-for-this-question"
          : "the-support-knowledge-base-did-not-contain-an-answer";

    const disclaimer =
      "Support answer assembled only from the platform's own support knowledge base and, for account questions, " +
      "the read-only status of your own records. Every point is a citation of an evidence row - no answer text is " +
      "generated here, and this assistant cannot change your account, billing, credits or licenses. When it cannot " +
      "resolve a question it hands off to human support. Not financial advice.";

    // Cite exactly what the answer rests on: the strong KB citations + every
    // account finding. Weak retrieved rows stay in the trace but are not
    // referenced by the output (keeps A6 lineage tight + honest).
    const usedEvidenceIds = [
      ...citations.map((c) => c.evidenceId),
      ...accountFindings.map((f) => f.evidenceId),
    ];

    return {
      output: {
        kind: "support-answer",
        resolved,
        coverage,
        citationCount: citations.length,
        topics: [...topics],
        citations: citations.slice(0, 12),
        accountFindings,
        escalate,
        escalationReason,
        evidenceCount: trace.evidence.length,
        evidenceIds: usedEvidenceIds,
        disclaimer,
      },
      summary:
        `support answer: ${coverage}, ${citations.length} citation(s)` +
        `${hasAccountContext ? `, ${accountFindings.length} account finding(s)` : ""}` +
        `${escalate ? " -> escalated to human support" : ""}`,
    };
  },
};

function shapeSupportInput(toolId: string, goal: ParsedGoal): unknown {
  if (toolId === KB_TOOL) {
    const query =
      goal.question ||
      (typeof goal.raw === "string" ? goal.raw : "") ||
      "support";
    return { query };
  }
  if (toolId === ACCOUNT_TOOL) {
    return {}; // every domain; the tool scopes to the session user
  }
  return {};
}

function readTopic(e: RunTrace["evidence"][number]): string {
  const d = e.data as { topic?: unknown } | null;
  if (d && typeof d.topic === "string" && d.topic.trim()) return d.topic;
  // fall back to the "support-kb:<topic>" source label
  const m = /^support-kb:(.+)$/.exec(e.source);
  return m ? m[1] : "support";
}

function readDomain(e: RunTrace["evidence"][number]): string {
  const m = /^account:(.+)$/.exec(e.source);
  return m ? m[1] : "account";
}
