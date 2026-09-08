// config/knowledge-loop.config.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. LOCKED defaults from
// KNOWLEDGE_RETRIEVAL_CONTRACT.md §9 and §4 (AUTHORITY_WEIGHTS). Tunable here
// only — never inline a magic number at a call site.

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
  /** In-process retrieval cache TTL (best-effort, per serverless instance). */
  RETRIEVAL_CACHE_TTL_MS: 10 * 60 * 1000,
  /** Postgres answer cache TTL (written by K5). */
  ANSWER_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
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

/** knowledgeType === "policy" → always max authority (contract §4 override). */
export const POLICY_TYPE_AUTHORITY = 1.0;
/** scope === "user" unverified rows — never outrank verified knowledge. */
export const USER_SCOPE_AUTHORITY = 0.5;
/** Fallback when a row has no sourceType (should not happen for loop rows). */
export const DEFAULT_AUTHORITY = 0.75;
