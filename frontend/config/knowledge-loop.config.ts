// config/knowledge-loop.config.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. LOCKED defaults from
// KNOWLEDGE_RETRIEVAL_CONTRACT.md §9 and §4 (AUTHORITY_WEIGHTS). Tunable here
// only — never inline a magic number at a call site.
// Sprint K2 — + retrieval-cache + freshness-sweep constants (§7.2/§7.6/§5).

/**
 * Retrieval-cache CONFIG_VERSION (KNOWLEDGE_RETRIEVAL_CONTRACT.md §7.6). Folded
 * into every `KnowledgeRetrievalCache` key. **Bump this whenever a ranking /
 * threshold / selection constant changes** — `RELEVANCE_MIN`, `RELEVANCE_GOOD`,
 * `STALE_PENALTY`, `CHUNKS_PER_DOC_MAX`, `CONTEXT_CHAR_BUDGET`, `RETRIEVE_TOP_K`
 * default, or `AUTHORITY_WEIGHTS` / the authority overrides — so every cached
 * entry is invalidated with no migration and no delete pass.
 */
export const RETRIEVAL_CONFIG_VERSION = "k2-1";

export const KNOWLEDGE_LOOP_CONFIG = {
  /** Rows pulled from pgvector before filtering/ranking. */
  RETRIEVE_TOP_K: 12,
  /** Hard similarity floor — a hit below this is dropped. Matches the
   *  pre-K1 chat route's MIN_SIMILARITY. */
  RELEVANCE_MIN: 0.3,
  /** "Sufficient" threshold — at least one finalScore ≥ this and not stale. */
  RELEVANCE_GOOD: 0.45,
  /** Assembled context block char cap. Matches the pre-K1 MAX_CONTEXT_CHARS. */
  CONTEXT_CHAR_BUDGET: 6000,
  /** De-dup cap: at most this many chunks from one knowledge doc. */
  CHUNKS_PER_DOC_MAX: 2,
  /** finalScore penalty applied to a review-due PERIODIC row. */
  STALE_PENALTY: 0.15,
  /** Retrieval cache TTL. K2: Postgres-backed (`KnowledgeRetrievalCache`) per
   *  ADR-K2-RETR-CACHE — was in-process `TtlCache` in K0.3. */
  RETRIEVAL_CACHE_TTL_MS: 10 * 60 * 1000,
  /** Daily purge deletes retrieval-cache rows whose `expiresAt` is older than
   *  now minus this grace (same shape as the answer-cache cleanup). */
  RETRIEVAL_CACHE_PURGE_GRACE_MS: 7 * 24 * 60 * 60 * 1000,
  /** Postgres answer cache TTL (written by K5 — NOT touched by K2). */
  ANSWER_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  /** Freshness sweep (K2-C): a PERIODIC row this many multiples past its
   *  review-due date is flagged "long overdue" in the sweep report. It is
   *  still NOT auto-deprecated — only DYNAMIC-past-`expiresAt` rows are. */
  PERIODIC_LONG_OVERDUE_FACTOR: 2,
  /** Candidate dedup: ≥ this cosine → attach as duplicate, don't create (K4). */
  DUP_HARD: 0.94,
  /** Candidate dedup: ≥ this cosine → create with duplicateOfId recorded (K4). */
  DUP_SOFT: 0.85,
  /** pgvector schema dimensionality — MUST equal lib/ai EMBEDDING_DIMENSIONS. */
  EMBEDDING_DIMENSIONS: 768,
  /** Default review cadence (days) for a PERIODIC row with none set. */
  DEFAULT_PERIODIC_REVIEW_DAYS: 90,
} as const;

// KNOWLEDGE_RETRIEVAL_CONTRACT.md §4 — source-authority weighting. Affects
// RANKING ONLY, never the threshold. Keyed by KnowledgeSourceType. A row whose
// knowledgeType === "policy" is forced to 1.0 (see authorityWeightFor); a
// scope === "user" row is capped at USER_SCOPE_AUTHORITY.
export const AUTHORITY_WEIGHTS: Record<string, number> = {
  admin_authored: 1.0,
  existing_documentation: 0.95,
  support_resolution: 0.9,
  verified_qa: 0.85,
  assistant_correction: 0.85,
  web_researched: 0.75,
  unanswered_question: 0.75,
};

// ── K3 — AI Assistant answer orchestration (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) ──
// Additive: nothing here is read by K1/K2 code. Tunable only — the orchestrator
// and provider slots inline no magic numbers.
export const KNOWLEDGE_ANSWER_CONFIG = {
  /** Scopes the AI Assistant retrieves against (contract §4). The Support
   *  Agent uses ["support","shared"] — deliberately disjoint, no contamination. */
  ASSISTANT_SCOPES: ["assistant", "shared"] as const,
  /** Chunks requested from KnowledgeService for one answer turn. */
  RETRIEVE_TOP_K: 6,
  /** max_tokens for the answer-generation call (every slot). */
  ANSWER_MAX_TOKENS: 2048,
  /** Anthropic native web_search `max_uses` per answer turn. */
  WEB_SEARCH_MAX_USES: 4,
  /** Prior turns handed to the provider (chronological, most-recent-N). */
  HISTORY_TURNS_MAX: 8,
  /** Fixed pointer returned for an `account-specific` question — no LLM call,
   *  never guesses account state (contract §8, sourceClass DETERMINISTIC). */
  ACCOUNT_SPECIFIC_POINTER:
    "That question is about your own account. I can't see your account details " +
    "here — please check your dashboard billing/settings page, or contact support " +
    "so a person can look it up securely.",
} as const;

/** knowledgeType === "policy" → always max authority (contract §4 override). */
export const POLICY_TYPE_AUTHORITY = 1.0;
/** scope === "user" unverified rows — never outrank verified knowledge. */
export const USER_SCOPE_AUTHORITY = 0.5;
/** Fallback when a row has no sourceType (should not happen for loop rows). */
export const DEFAULT_AUTHORITY = 0.75;
