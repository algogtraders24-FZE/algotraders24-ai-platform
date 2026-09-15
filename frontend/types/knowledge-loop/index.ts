// types/knowledge-loop/index.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop: contract types.
// Mirrors the LOCKED contracts (docs/architecture/KNOWLEDGE_CONTRACT.md §3,
// KNOWLEDGE_RETRIEVAL_CONTRACT.md §3). Vendor-neutral; no `@relation` shapes.

import type {
  KnowledgeStatus,
  KnowledgeScope,
  KnowledgeVisibility,
  KnowledgeType,
  KnowledgeFreshnessClass,
  KnowledgeSourceType,
  CandidateStatus,
} from "@/lib/generated/prisma/enums";

export type {
  KnowledgeStatus,
  KnowledgeScope,
  KnowledgeVisibility,
  KnowledgeType,
  KnowledgeFreshnessClass,
  KnowledgeSourceType,
  CandidateStatus,
};

// ── Provenance (KNOWLEDGE_CONTRACT.md §3) ──────────────────────────────
// Shared shape for `Knowledge.provenance` and `KnowledgeCandidate.evidence`.
// NEVER a secret, an API key, or a raw provider payload.
export interface KnowledgeSourceRef {
  knowledgeId: string;
  chunkId: string;
  similarity: number;
}
export interface WebSourceRef {
  url: string;
  title: string;
  domain: string;
  retrievedAt: string;
  excerpt: string;
  relevance?: number;
}
export type ProvenanceOrigin =
  | "candidate"
  | "admin-authored"
  | "support-resolution"
  | "import"
  | "web-researched";
export interface KnowledgeProvenance {
  origin: ProvenanceOrigin;
  createdBy: string;
  createdAt: string;
  originatingConversationId?: string;
  originatingMessageId?: string;
  knowledgeSources?: KnowledgeSourceRef[];
  webSources?: WebSourceRef[];
  reviewerNotes?: string;
  editedByReviewer?: boolean;
}

// ── The subset of a `Knowledge` row the loop's service + retrieval need. ──
// A store adapter maps the real Prisma row (or an in-memory fixture) to this.
export interface KnowledgeRecord {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: string;
  canonicalQuestion: string | null;
  canonicalAnswer: string | null;
  knowledgeType: KnowledgeType | null;
  scope: KnowledgeScope;
  visibility: KnowledgeVisibility;
  source: string;
  sourceType: KnowledgeSourceType | null;
  provenance: KnowledgeProvenance | null;
  confidence: number | null;
  /** Legacy free-string column — untouched. */
  status: string;
  /** Knowledge Loop lifecycle. null for legacy scope=user rows. */
  lifecycleStatus: KnowledgeStatus | null;
  embeddingStatus: string;
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  freshnessClass: KnowledgeFreshnessClass | null;
  freshnessReviewEveryDays: number | null;
  expiresAt: Date | null;
  lastReviewedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  deprecatedAt: Date | null;
  deprecatedBy: string | null;
  retrievalCount: number;
  lastRetrievedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface KnowledgeChunkRecord {
  chunkId: string;
  knowledgeId: string;
  userId: string;
  chunkIndex: number;
  content: string;
}

// ── Retrieval (KNOWLEDGE_RETRIEVAL_CONTRACT.md §3) ─────────────────────
export type Sufficiency = "SUFFICIENT" | "LOW" | "INSUFFICIENT" | "STALE";

export interface RetrievalOptions {
  callerUserId: string;
  callerRole: string;
  /** e.g. ["assistant","shared"] for the AI Assistant; ["support","shared"] for Support. */
  scopes: KnowledgeScope[];
  topK?: number;
  knowledgeId?: string;
  /** default true — also search the caller's own scope=user rows. */
  includeUserScope?: boolean;
  /** best-effort — recorded on the KnowledgeRetrievalLog row. */
  conversationId?: string;
}

export interface RetrievalHit {
  knowledgeId: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  finalScore: number;
  authorityWeight: number;
  sourceType: KnowledgeSourceType | null;
  freshnessClass: KnowledgeFreshnessClass | null;
  scope: KnowledgeScope;
  stale: boolean;
  version: number;
  /** true for a scope=user row — the orchestrator must label it unverified. */
  unverified: boolean;
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  contextBlock: string;
  sufficiency: Sufficiency;
  conflict?: { aId: string; bId: string };
  bestSimilarity: number;
  fromCache: boolean;
  latencyMs: number;
  /** diagnostic — "empty-query" | "embedding-failed" | "below-threshold" | "no-eligible-rows" | "ok". */
  reason: string;
}

// ── Retrieval cache (K2 — KNOWLEDGE_RETRIEVAL_CONTRACT.md §7.2 / §7.5 / §7.6) ──
// Stored per cache key: chunk ids + similarity ONLY. Never answer text, never a
// Knowledge row snapshot. On a hit the service re-hydrates Knowledge/
// KnowledgeChunk LIVE and re-runs the full eligibility filter + ranking.
export interface CachedRetrievalEntry {
  chunkId: string;
  knowledgeId: string;
  chunkIndex: number;
  similarity: number;
}
export interface CachedRetrieval {
  results: CachedRetrievalEntry[];
}

// ── Freshness sweep (K2-C — KNOWLEDGE_CONTRACT.md §5, transition table §4.4) ──
export interface FreshnessSweepResult {
  scannedActive: number;
  /** DYNAMIC rows past `expiresAt` — auto-transitioned to `deprecated`
   *  (reason `expired`). Retrieval already excluded them; this makes it
   *  permanent + auditable and bumps the version fingerprint. */
  dynamicExpiredDeprecated: Array<{ knowledgeId: string; expiresAt: string }>;
  /** PERIODIC rows past review-due — FLAGGED ONLY, never auto-transitioned
   *  (that needs a human — K4/K6). Retrieval already demotes them via
   *  STALE_PENALTY at query time. */
  periodicReviewDue: Array<{
    knowledgeId: string;
    dueSince: string;
    longOverdue: boolean;
  }>;
  /** fingerprint after all auto-deprecations (unchanged if none). */
  versionFingerprint: string;
  ranAt: string;
}

// ── Lifecycle transitions (KNOWLEDGE_CONTRACT.md §4.4) ─────────────────
export interface TransitionResult {
  knowledge: KnowledgeRecord;
  /** monotonic KnowledgeVersionCounter value AFTER the transition. */
  versionFingerprint: string;
}

export interface NewVersionResult {
  created: KnowledgeRecord;
  deprecated: KnowledgeRecord;
  versionFingerprint: string;
}

export interface CreateKnowledgeInput {
  userId: string;
  title: string;
  description?: string;
  category?: string;
  canonicalQuestion?: string | null;
  canonicalAnswer?: string | null;
  knowledgeType: KnowledgeType;
  scope: KnowledgeScope;
  visibility?: KnowledgeVisibility;
  source: string;
  sourceType: KnowledgeSourceType;
  provenance: KnowledgeProvenance;
  confidence?: number | null;
  freshnessClass: KnowledgeFreshnessClass;
  freshnessReviewEveryDays?: number | null;
  expiresAt?: Date | null;
}

// ── K3 — orchestration (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §3, §5, §8) ──

// The provider-neutral web-source shape lives in lib/ai (ClaudeProvider fills
// it from Anthropic's native web_search). Re-exported here so the K3
// orchestrator surface is one import.
export type { AIWebSource } from "@/lib/ai/types";

export type AssistantIntent =
  | "conceptual"
  | "product-static"
  | "how-to"
  | "policy"
  | "support-troubleshoot"
  | "current-info"
  | "account-specific"
  /** K3-C §12.1 — an unambiguously retrospective question ("back in 2021…",
   *  "what happened to…", "used to…"). Never web-forced by freshness. */
  | "historical"
  | "other";
export type FreshnessNeed = "STATIC" | "PERIODIC" | "DYNAMIC";
export type PrivacyClass = "public" | "user-specific" | "sensitive";

export interface Classification {
  intent: AssistantIntent;
  freshnessNeed: FreshnessNeed;
  privacyClass: PrivacyClass;
  /** the message explicitly asked for current/latest info. */
  explicitFreshnessRequest: boolean;
}

export interface WebSearchGateResult {
  /** K3-C §12.2 — whether to OFFER Claude's native web_search tool this turn.
   *  This is an OFFER, not a prediction: the model still decides whether it
   *  actually needs to search. "search happened" is `webSearchUsed` on the
   *  answer, computed later from the provider response. */
  useWebSearch: boolean;
  /** "explicit-freshness" | "dynamic-need" | "insufficient" | "stale" |
   *  "borderline-sufficient" | "forbidden-sensitive" | "forbidden-account" |
   *  "forbidden-conceptual-sufficient" | "not-needed". */
  reason: string;
}

/** §8 — deterministic source class. `DETERMINISTIC` = a fixed pointer/fallback
 *  string, no LLM call (e.g. an account-specific question). */
export type AnswerSourceClass =
  | "AT24_KNOWLEDGE"
  | "CLAUDE_REASONING"
  | "CLAUDE_WEB_SEARCH"
  | "MIXED"
  | "DETERMINISTIC";

export interface AnswerTurn {
  requestId: string;
  callerUserId: string;
  callerRole: string;
  conversationId?: string;
  messageId?: string;
  message: string;
  /** prior turns, chronological (already loaded by the route). */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** optional active-instrument bias — passed through, never forced. */
  symbol?: string;
  /** optional single-document scoping — restricts retrieval to this
   *  Knowledge row (the route's legacy `knowledgeId` body param). */
  knowledgeId?: string;
}

export interface AnswerSourceRef {
  kind: "knowledge" | "web";
  knowledgeId?: string;
  chunkId?: string;
  chunkIndex?: number;
  similarity?: number;
  /** knowledge: a short excerpt of the retrieved chunk (for a Sources panel). */
  snippet?: string;
  url?: string;
  title?: string;
  citedText?: string;
  usedInAnswer: boolean;
}

export interface AnswerProviderAttempt {
  provider: string;
  attempted: boolean;
  ok: boolean;
  failure?: string;
  latencyMs?: number;
  forbiddenLanguage?: boolean;
}

export interface AnswerResult {
  text: string;
  sourceClass: AnswerSourceClass;
  providerUsed: string;
  webSearchUsed: boolean;
  webSearchRequestedButUnavailable: boolean;
  sources: AnswerSourceRef[];
  retrievalSufficiency: Sufficiency;
  classification: Classification;
  fromCache: boolean;
  integrityPassed: boolean;
  latencyMs: number;
  /** id of the KnowledgeAnswerProvenance row written (best-effort). */
  provenanceId?: string;
}

/** K3-C §12.6 — per-turn telemetry. Rides in the persisted `providerAttempts`
 *  JSON under a `meta` key (no new scalar column, no migration). ZERO raw
 *  content — every field is a boolean / small int / enum / float. */
export type AnswerFailureCategory =
  | null
  | "provider-error"
  | "forbidden-language"
  | "empty-output"
  | "continuation-exhausted"
  | "chain-exhausted"
  | "dynamic-unverifiable";

export interface TurnMeta {
  webSearchOffered: boolean;
  /** the web-search gate's reason string (a fixed enum-like token). */
  gateReason: string;
  webSearchUsed: boolean;
  /** operational fact — a web-search OPERATION failed (§12.4). */
  webSearchFailed: boolean;
  webSearchPartialFailure: boolean;
  /** evidence fact — the gate required web-grounded evidence, the final
   *  answer did not obtain it (§12.4). Independent of `webSearchFailed`. */
  webSearchRequestedButUnavailable: boolean;
  searchCount: number;
  continuationCount: number;
  continuationBudgetExhausted: boolean;
  truncated: boolean;
  failureCategory: AnswerFailureCategory;
  knowledgeHitCount: number;
  bestSimilarity: number;
  /** K3-C §12.6/C8 — was this turn's retrieval served from the K2 retrieval
   *  cache (`RetrievalResult.fromCache`)? Cost/observability signal only —
   *  never changes eligibility (K2 re-hydrates + re-filters live on a hit). */
  retrievalFromCache: boolean;
  /** K3-C C8 — cost-relevant usage from the WINNING provider's response,
   *  where the provider surfaces it (`AICompletionResponse.usage`). `null`
   *  when unavailable (deterministic terminal, or a provider that doesn't
   *  report usage) — never fabricated. */
  promptTokens: number | null;
  completionTokens: number | null;
}

/** what the provenance store persists (KnowledgeAnswerProvenance row shape). */
export interface KnowledgeAnswerProvenanceInput {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  requestId: string;
  sourceClass: AnswerSourceClass;
  knowledgeContributions: AnswerSourceRef[];
  webContributions: AnswerSourceRef[];
  providerUsed: string;
  providerAttempts: AnswerProviderAttempt[];
  /** K3-C §12.6 — folded into the persisted `providerAttempts` JSON `meta`
   *  by the store. Optional so a pre-C5 caller still compiles. */
  turnMeta?: TurnMeta;
  webSearchUsed: boolean;
  webSearchRequestedButUnavailable: boolean;
  retrievalSufficiency: string;
  conflict: { aId: string; bId: string } | null;
  integrityPassed: boolean;
  freshnessClass: string | null;
  privacyClass: string | null;
  candidateCreatedId: string | null;
  answerCached: boolean;
  servedFromCache: boolean;
  latencyMs: number;
}

// ── K4.2-A — Candidate capture (KNOWLEDGE_GOVERNANCE_CONTRACT.md §7-8,
//    K4.2A_CANDIDATE_CAPTURE.md). Additive only — nothing above this line
//    changes. `CandidateService.propose()` is the ONLY writer of these. ──

export type CandidateReason =
  | "unanswered-high-value"
  | "web-answer-worth-keeping"
  | "assistant-correction"
  | "admin-flagged"
  | "support-resolution"
  | "imported-doc";

/** the subset of a `KnowledgeCandidate` row callers need — a store adapter
 *  maps the real Prisma row (or an in-memory fixture) to this. */
export interface CandidateRecord {
  id: string;
  createdByUserId: string;
  originatingConversationId: string | null;
  originatingMessageId: string | null;
  canonicalQuestion: string;
  proposedAnswer: string;
  knowledgeType: KnowledgeType;
  proposedScope: KnowledgeScope;
  proposedVisibility: KnowledgeVisibility;
  proposedFreshnessClass: KnowledgeFreshnessClass;
  sourceType: KnowledgeSourceType;
  evidence: KnowledgeProvenance;
  confidence: number;
  reasonForCandidate: string;
  duplicateOfId: string | null;
  similarityScore: number | null;
  status: CandidateStatus;
  assignedReviewerId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  finalKnowledgeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProposeCandidateInput {
  createdByUserId: string;
  originatingConversationId?: string;
  originatingMessageId?: string;
  canonicalQuestion: string;
  proposedAnswer: string;
  knowledgeType: KnowledgeType;
  /** default "assistant" (K0.2 §8.1). */
  proposedScope?: KnowledgeScope;
  /** default "public". */
  proposedVisibility?: KnowledgeVisibility;
  /** default "STATIC" — a DYNAMIC proposal is a red flag for the reviewer. */
  proposedFreshnessClass?: KnowledgeFreshnessClass;
  sourceType: KnowledgeSourceType;
  reasonForCandidate: CandidateReason;
  /** 0-1, pipeline confidence at creation (K0.2 §8.1). */
  confidence: number;
  evidence?: {
    knowledgeSources?: KnowledgeSourceRef[];
    webSources?: WebSourceRef[];
  };
}

export type ProposeOutcome =
  | "created"
  | "idempotent-replay"
  | "blocked-privacy"
  | "blocked-invalid"
  | "duplicate-of-active";

export interface ProposeCandidateResult {
  outcome: ProposeOutcome;
  /** present for every outcome except blocked-privacy/blocked-invalid. */
  candidate?: CandidateRecord;
  /** present only for outcome === "blocked-privacy". */
  blockedReasons?: string[];
  /** present only for outcome === "blocked-invalid". */
  invalidReason?: string;
  /** non-blocking — always computed, never gates creation (K0.5 §7.2). */
  forbiddenLanguageWarnings: string[];
}
