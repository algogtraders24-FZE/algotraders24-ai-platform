// services/knowledge-loop/orchestrator/build-provenance.ts
// Sprint K3-C (C4) — provenance integrity as ONE pure builder
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.6).
//
// Provenance is EVIDENCE OF WHAT HAPPENED, never an LLM explanation of what
// supposedly happened. This module turns the SETTLED facts of a turn into:
//   1. `sources`          — AnswerSourceRef[] with HONEST `usedInAnswer`
//   2. `provenanceInput`  — the KnowledgeAnswerProvenance row shape
// deterministically. Nothing here calls an LLM, opens a DB, or reads the raw
// user query / answer text / history — `ProvenanceFacts` structurally cannot
// carry them.
//
// Invariants LOCKED by `validate-knowledge-loop-provenance-integrity`:
//   - `usedInAnswer` = ACTUAL contribution, not "was retrieved":
//       knowledge chunk  → true ONLY when sourceClass === "AT24_KNOWLEDGE"
//       web source       → true ONLY when Claude actually cited it
//   - `sourceClass` from the OUTCOME (deriveSourceClass), never provider identity
//   - `providerUsed` = the real winning slot
//   - a failed / abandoned provider never becomes the evidence source
//   - `webSearchFailed` (operational) ⟂ `webSearchRequestedButUnavailable`
//     (evidence = gate offered web AND the winner is not web-grounded)
//   - NO raw query / answer / history / secret in the row (sanitised)
//
// C4 does NOT wire this into the orchestrator — that is C5 (the single
// integration of the locked C2/C3/C4 contracts).

import type {
  AnswerProviderAttempt,
  AnswerSourceRef,
  AIWebSource,
  Classification,
  KnowledgeAnswerProvenanceInput,
  Sufficiency,
  TurnMeta,
  AnswerFailureCategory,
} from "@/types/knowledge-loop";
import { deriveSourceClass } from "./decide-path";

// ── the settled facts of a turn (NO raw message / answer / history) ────
export interface ProvenanceRetrievalFacts {
  sufficiency: Sufficiency;
  bestSimilarity: number;
  contextBlockNonEmpty: boolean;
  conflict: { aId: string; bId: string } | null;
  /** account-specific route — retrieval was intentionally skipped. */
  skipped: boolean;
  hits: Array<{
    knowledgeId: string;
    chunkId: string;
    chunkIndex: number;
    similarity: number;
    /** the retrieved KNOWLEDGE chunk text (admin-authored) — excerpted to
     *  ≤180 chars for the row; never user content. */
    content: string;
    freshnessClass: string | null;
  }>;
}

export type ProvenanceOutcome =
  | { kind: "deterministic"; reason: Extract<AnswerFailureCategory, "chain-exhausted" | "dynamic-unverifiable"> | "account-specific" }
  | {
      kind: "generated";
      providerUsed: string;
      webSources: AIWebSource[];
      searchCount: number;
      webSearchUsed: boolean;
      webSearchFailed: boolean;
      webSearchPartialFailure: boolean;
      continuationCount: number;
      continuationBudgetExhausted: boolean;
      truncated: boolean;
    };

export interface ProvenanceFacts {
  turn: {
    requestId: string;
    callerUserId: string;
    conversationId?: string;
    messageId?: string;
  };
  classification: Classification;
  retrieval: ProvenanceRetrievalFacts;
  decision: { webSearchOffered: boolean; gateReason: string };
  outcome: ProvenanceOutcome;
  /** every provider slot tried this turn (winner + abandoned). */
  attempts: AnswerProviderAttempt[];
  latencyMs: number;
}

export interface BuiltProvenance {
  sources: AnswerSourceRef[];
  provenanceInput: KnowledgeAnswerProvenanceInput;
}

const MAX_PROVENANCE_STRING = 300;

/** §12.6 defence-in-depth — a provider error string should never carry a
 *  secret or PII, but redact anyway. Same patterns as the classifier's
 *  SENSITIVE detector. */
export function sanitizeProvenanceText(s: string): string {
  return s
    .replace(/\bsk-[a-z0-9-]{10,}/gi, "sk-***REDACTED***")
    .replace(/\bbearer\s+[a-z0-9._-]{16,}/gi, "Bearer ***REDACTED***")
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "***REDACTED-PEM***")
    .replace(/\b\d{13,19}\b/g, "***REDACTED-NUM***")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "***EMAIL-REDACTED***")
    .slice(0, MAX_PROVENANCE_STRING);
}

function sanitizeAttempts(
  attempts: AnswerProviderAttempt[],
): AnswerProviderAttempt[] {
  return attempts.map((a) => ({
    provider: a.provider,
    attempted: a.attempted,
    ok: a.ok,
    ...(a.failure !== undefined
      ? { failure: sanitizeProvenanceText(a.failure) }
      : {}),
    ...(a.latencyMs !== undefined ? { latencyMs: a.latencyMs } : {}),
    ...(a.forbiddenLanguage !== undefined
      ? { forbiddenLanguage: a.forbiddenLanguage }
      : {}),
  }));
}

function knowledgeCounted(r: ProvenanceRetrievalFacts): boolean {
  return (
    !r.skipped &&
    r.hits.length > 0 &&
    r.contextBlockNonEmpty &&
    (r.sufficiency === "SUFFICIENT" || r.sufficiency === "LOW")
  );
}

function deriveFailureCategory(
  facts: ProvenanceFacts,
): AnswerFailureCategory {
  const { outcome, attempts } = facts;
  if (outcome.kind === "deterministic") {
    return outcome.reason === "account-specific" ? null : outcome.reason;
  }
  // generated: if a slot was abandoned before the winner, name why (the
  // last failed attempt). Otherwise no failure.
  const failed = attempts.filter((a) => a.attempted && !a.ok);
  if (failed.length === 0) return null;
  const last = failed[failed.length - 1];
  if (last.forbiddenLanguage) return "forbidden-language";
  if (last.failure === "empty-output") return "empty-output";
  if (last.failure?.startsWith("continuation")) return "continuation-exhausted";
  return "provider-error";
}

export function buildProvenance(facts: ProvenanceFacts): BuiltProvenance {
  const { turn, classification, retrieval, decision, outcome } = facts;
  const kCounted = knowledgeCounted(retrieval);

  // ── sourceClass + web-grounded ──────────────────────────────────────
  const webUsed =
    outcome.kind === "generated" ? outcome.webSearchUsed : false;
  const sourceClass =
    outcome.kind === "deterministic"
      ? ("DETERMINISTIC" as const)
      : deriveSourceClass({ webUsed, knowledgeCounted: kCounted });

  // ── per-source `usedInAnswer` — ACTUAL contribution only ────────────
  const knowledgeUsed = sourceClass === "AT24_KNOWLEDGE";
  const knowledgeRefs: AnswerSourceRef[] =
    // a deterministic answer cites nothing; retrieval hits were already
    // logged by the retrieval layer.
    outcome.kind === "deterministic"
      ? []
      : retrieval.hits.map((h) => ({
          kind: "knowledge",
          knowledgeId: h.knowledgeId,
          chunkId: h.chunkId,
          chunkIndex: h.chunkIndex,
          similarity: h.similarity,
          snippet:
            h.content.length > 180 ? `${h.content.slice(0, 180)}…` : h.content,
          usedInAnswer: knowledgeUsed,
        }));

  const webRefs: AnswerSourceRef[] =
    outcome.kind === "generated"
      ? outcome.webSources.map((s) => ({
          kind: "web",
          url: s.url,
          title: s.title,
          citedText: s.citedTexts[0],
          // web attribution = ACTUAL citation, not "was in the results".
          usedInAnswer: (s.citedTexts?.length ?? 0) > 0,
        }))
      : [];

  const sources = [...knowledgeRefs, ...webRefs];

  // ── the two independent web-search signals (§12.4) ─────────────────
  const webSearchFailed =
    outcome.kind === "generated" ? outcome.webSearchFailed : false;
  // evidence fact — gate offered web AND the winner did not obtain a
  // web-grounded answer, REGARDLESS of which provider won or why.
  const webSearchRequestedButUnavailable = decision.webSearchOffered && !webUsed;

  // ── retrievalSufficiency — "SKIPPED" sentinel for account-specific (C4-c) ──
  const retrievalSufficiency = retrieval.skipped
    ? "SKIPPED"
    : retrieval.sufficiency;

  const integrityPassed = !(
    outcome.kind === "deterministic" && outcome.reason === "chain-exhausted"
  );

  const turnMeta: TurnMeta = {
    webSearchOffered: decision.webSearchOffered,
    gateReason: decision.gateReason,
    webSearchUsed: webUsed,
    webSearchFailed,
    webSearchPartialFailure:
      outcome.kind === "generated" ? outcome.webSearchPartialFailure : false,
    webSearchRequestedButUnavailable,
    searchCount: outcome.kind === "generated" ? outcome.searchCount : 0,
    continuationCount:
      outcome.kind === "generated" ? outcome.continuationCount : 0,
    continuationBudgetExhausted:
      outcome.kind === "generated" ? outcome.continuationBudgetExhausted : false,
    truncated: outcome.kind === "generated" ? outcome.truncated : false,
    failureCategory: deriveFailureCategory(facts),
    knowledgeHitCount: retrieval.hits.length,
    bestSimilarity: retrieval.bestSimilarity,
  };

  const provenanceInput: KnowledgeAnswerProvenanceInput = {
    userId: turn.callerUserId,
    conversationId: turn.conversationId ?? null,
    messageId: turn.messageId ?? null,
    requestId: turn.requestId,
    sourceClass,
    knowledgeContributions: knowledgeRefs,
    webContributions: webRefs,
    providerUsed:
      outcome.kind === "generated" ? outcome.providerUsed : "deterministic",
    providerAttempts: sanitizeAttempts(facts.attempts),
    turnMeta,
    webSearchUsed: webUsed,
    webSearchRequestedButUnavailable,
    retrievalSufficiency,
    conflict: retrieval.conflict,
    integrityPassed,
    freshnessClass: retrieval.hits[0]?.freshnessClass ?? null,
    privacyClass: classification.privacyClass,
    candidateCreatedId: null, // K4 — never in K3
    answerCached: false, // K5
    servedFromCache: false, // K5
    latencyMs: facts.latencyMs,
  };

  return { sources, provenanceInput };
}
