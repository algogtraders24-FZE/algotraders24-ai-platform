# K0_DECISION — AT24 AI Assistant Knowledge Loop

**Sprint:** K0 — R&D + Architecture + Contract Lock
**Stage:** Decision lock — precedes K1 implementation
**Inputs:** K0 sprint brief; codebase audit;
[`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md),
[`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md),
[`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md),
[`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md),
[`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md),
[`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md);
AN1.2 (agent framework locked decisions); AN1.9 (memory governance precedent).
**Status:** **7 decisions PROPOSED · 4 PENDING owner sign-off · implementation NOT started**

> This document is the single source of truth for the Knowledge Loop
> architecture. A change to any LOCKED decision requires a new dated ADR entry
> here, never an inline code choice.

---

## 0. Core principle (proposed LOCK)

> **The Knowledge Loop orchestrates the *existing* AT24 RAG stack, `lib/ai`
> provider layer, and analytics/audit infrastructure. It makes the assistant
> better over time through human-verified knowledge only. It never lets an
> unreviewed user conversation become authoritative knowledge, and it never
> silently treats a web result as AT24 knowledge.**

Optimise for: **correctness → traceability → governance → low latency → low
cost → beta readiness.** Not for sophistication.

---

## 1. R&D findings — the 20 questions answered

| # | Question | Finding |
|---|---|---|
| 1 | Claude API capabilities in AT24 today | `ClaudeProvider` (`lib/ai/providers/claude.provider.ts`) — a real REST call to Anthropic's Messages API, **no `@anthropic-ai/sdk`**, injectable `fetch`. Supports `system` + `messages` + `max_tokens` + `temperature`. **No tool-use / server-tools support.** Wired as a fallback slot in `AIPresenterOrchestratorService` (Gemini→Claude→OpenAI→deterministic). **No `ANTHROPIC_API_KEY` in the project** — untested against the live API. |
| 2 | Native web-search capability via the selected Claude integration | **None today.** The only web grounding in the codebase is Gemini's `googleSearch` tool in `app/api/private/knowledge/chat/route.ts`. Anthropic's Messages API offers a native `web_search_20250305` **server tool** — using it requires extending `ClaudeProvider` to send `tools` and parse `server_tool_use` / `web_search_tool_result` blocks. Small, well-documented change; **no search vendor needed** (no Tavily/Exa). |
| 3 | Injecting AT24 knowledge into Claude context | Established pattern: retrieve chunks → assemble a `- <chunk>\n` context block ≤ `MAX_CONTEXT_CHARS` (6000) → pass as a `system` segment alongside `AI_COMMUNICATION_POLICY`. `ClaudeProvider.splitSystem()` already folds system-role messages into Anthropic's top-level `system` field. Reuse verbatim. |
| 4 | Existing PostgreSQL/Supabase vector retrieval | **Yes, production.** `KnowledgeChunk.embedding vector(768)`, HNSW `vector_cosine_ops` index (migration `20260720000000`). Queried via `VectorRepository.searchSimilar()` — parameterized raw SQL, `1 - (embedding <=> $1::vector)` similarity, `userId`/`knowledgeId` filters, `MAX_TOP_K = 100`. The `vector` column is deliberately **absent from the Prisma schema** (Prisma 7 `Unsupported("vector")` drift, issue #28867). |
| 5 | Existing Prisma architecture relevant to Knowledge | `Knowledge`, `KnowledgeChunk`, `KnowledgeCollection` models; `KnowledgeRepository` / `KnowledgeChunkRepository` / `VectorRepository` via `RepositoryFactory`; `IngestionService` orchestrates validate→chunk→persist→embed→store. `Knowledge` is **per-user only** (every row has `userId`; retrieval always `userId`-scoped) — the key gap for a shared assistant KB. `status`/`embeddingStatus` are free-strings, no lifecycle. |
| 6 | Existing embedding provider/model | `GeminiEmbeddingProvider` — `gemini-embedding-001`, native 3072-d reduced to **768** via `outputDimensionality` (MRL), L2-normalized. `EMBEDDING_DIMENSIONS = 768` is locked to the pgvector schema. |
| 7 | Existing cache infrastructure | **No shared cache.** `lib/market-data/cache.ts` `TtlCache` (in-process, per serverless instance) and a small `ApiClient` client-side cache. No Redis / Vercel KV / Upstash. Vercel **Hobby** plan. |
| 8 | Existing analytics/event infrastructure | `AnalyticsEvent` (append-only, free-string `type`, Json `metadata`) + `AnalyticsEventService` (`record`, `countsByType`, `distinctUserCount`, …). `RequestLog` (append-only per-request counters). `ProviderCallLog`. All internal, no third-party. |
| 9 | Existing admin authorization model | `requireAdmin(requestId, startedAt)` → `assertRole("admin")`. Every `/api/private/admin/*` route gates on it. `AuditLog` (append-only, **no update/delete path**) records every admin action with real before/after in `metadata`. |
| 10 | Existing AI Assistant architecture | `app/api/private/knowledge/chat/route.ts` — Gemini 2.5 Flash + `googleSearch`, RAG top-5, `MIN_SIMILARITY 0.3`, NDJSON streaming, `Conversation`/`Message` persistence, `context-manager.service.ts` deterministic context assembly. A resolved-instrument market question is delegated to `IntelligencePresentationService` (D2.6.9) which already writes an `IntelligenceAuditTrace` provenance record and runs the `AIPresenterOrchestratorService` multi-model fallback. Client entry: `services/ai/assistant.service.ts`. |
| 11 | Existing support-agent architecture | **Does not exist yet.** No support-agent code, no support-knowledge store. K0's job is to make the shared foundation *namespace-ready* (`scope` field) so a future Support Agent filters into it rather than forking a second RAG. |
| 12 | Best approach for semantic retrieval + reranking | pgvector HNSW cosine at `topK ≈ 12` + a deterministic weighted rank (`similarity × authorityWeight − stalePenalty`) is sufficient for beta. A cross-encoder/LLM reranker adds a model call per turn for marginal gain — **excluded from beta**, slots in behind a flag if K7 shows ranking is the bottleneck. |
| 13 | Token / cost implications | Per knowledge turn: 1 embedding call (~cheap, cached on repeats) + 1 Claude Messages call (~6k-char context + policy + ≤8 history turns ≈ 2–4k input tokens, ≤2k output). Web-search turns add Anthropic's per-search server-tool charge (`WEB_SEARCH_MAX_USES = 3`). Answer cache eliminates the whole chain for `STATIC` public questions. Full model/pricing reference: consult the `claude-api` skill before wiring K3. |
| 14 | Latency implications | Retrieval cache miss ≈ embed (≤400 ms p50) + pgvector (<50 ms). Claude no-web ≈ 3 s p50 / 8 s p95. Web-search ≈ 6 s p50 / 15 s p95. Cache hit < 150 ms. The current Gemini+Search path is already 60 s+ in the worst case (Master Audit D2.3.F) — Claude-native web search is expected to be **faster**, not slower. |
| 15 | Data retention implications | Governance §8: `Knowledge`/`Candidate`/`AuditLog` indefinite (soft-delete only); `KnowledgeAnswerProvenance` / `KnowledgeRetrievalLog` 180-day rolling with aggregate-then-purge; `KnowledgeAnswerCache` TTL + 7-day grace. Purges fit the one-cron/day budget. |
| 16 | Privacy risks from conversation → candidate ingestion | Real risk: a user's account details / PII / secrets in a conversation could enter a globally-retrievable candidate. **Mitigations (all locked):** (a) `privacyClass ≠ public` turns never produce a candidate; (b) a deterministic PII/secret/account-ref scanner blocks candidate creation *and* re-runs at approval; (c) `scope = user` rows never auto-promote; (d) approval requires a human admin who sees the originating conversation + scan result. |
| 17 | Preventing hallucinated Q&A from becoming knowledge | (a) Every answer passes an integrity check (`validateResponseIntegrity` pattern: forbidden-phrase scan + no fabricated AT24 claims vs. the knowledge block) before it can seed a candidate; (b) candidates are never auto-approved — a human admin reads the evidence; (c) a web-only answer with no `webSources` in evidence is rejected at creation; (d) the deterministic fallback never fabricates. |
| 18 | Detecting duplicate knowledge | Embedding cosine of the candidate's canonical question / proposed answer vs. `active` `Knowledge` and open candidates. `DUP_HARD = 0.94` → attach as duplicate, don't create; `DUP_SOFT = 0.85` → create with `duplicateOfId` + `similarityScore` recorded so the reviewer sees it. Reuses the same embedder + `VectorRepository`. |
| 19 | Detecting contradictory knowledge | Retrieval-time: two `active` rows in the same `canonicalQuestion` cluster (question cosine > 0.9) with divergent answer embeddings (cosine < 0.4), or an explicit admin `conflictsWithId` link → `RetrievalResult.conflict` set, both preserved, authoritative one chosen by policy (`AUTHORITY_WEIGHTS` → newer `approvedAt` → higher `version`), `KNOWLEDGE_CONFLICT` emitted, candidate created for admin resolution. No silent mutation. |
| 20 | Invalidating cached answers after knowledge changes | `knowledgeVersionFingerprint` — a single-row monotonic counter incremented **in the same transaction** as every lifecycle transition that changes retrieval output. It is part of every cache key, so a version change makes old keys unmatchable (**lazy invalidation** — no delete pass). Plus TTL and a manual admin flush. |

---

## 2. Recommended architecture (summary)

- **Retrieval:** reuse pgvector (`vector(768)`, HNSW) + `GeminiEmbeddingProvider`
  + `VectorRepository`. Add a `scope`/`visibility` filter. No vector DB, no
  new embedder, no reranker.
- **Knowledge model:** the *existing* `Knowledge` + additive columns
  (`scope`, `visibility`, `knowledgeType`, `status` enum, `version`,
  `freshnessClass`, `provenance`, `approvedAt/By`, …). `KnowledgeChunk`
  unchanged.
- **Candidates:** a **new `KnowledgeCandidate` model**, deliberately separate
  from `Knowledge` so the retriever (which queries `Knowledge` only) can never
  serve an unreviewed item — the AN1.9 "pending is never surfaced" guarantee.
- **Orchestrator:** a new composition layer behind the existing
  market-intelligence gate in `knowledge/chat`. Classify → knowledge-first
  retrieve → web-search gate → Claude (preferred) via the existing fallback
  chain → integrity check → always-on `KnowledgeAnswerProvenance` → optional
  candidate.
- **Web search:** Claude's native `web_search` server tool. No search vendor.
- **Governance:** reuse `AuditLog` + `requireAdmin`. Approval is explicit,
  human-only, no-agent, no-threshold. Two-point PII/secret scan.
- **Cache:** in-process retrieval cache (best-effort) + a **Postgres**
  `KnowledgeAnswerCache` for `STATIC`/public answers only, version-fingerprint
  invalidated.
- **Analytics:** 15 canonical events on `AnalyticsEvent` + a new
  `KnowledgeRetrievalLog` table for numeric aggregation. No third-party.
- **Support Agent:** one shared store, `scope`-namespaced. No second RAG.
- **Migration discipline:** generate offline via `prisma migrate diff`, hand
  review, apply via `prisma migrate deploy` under an explicit gate. **Never
  `prisma migrate dev`** (pgvector-reset trap).

---

## 3. LOCKED decisions

### D-CORE — Knowledge-first precedence, threshold-gated fallthrough
The 4-priority precedence (architecture §1) is locked. "Knowledge first" ≠
"knowledge only": below `RELEVANCE_GOOD`, stale, contradictory, or absent →
the orchestrator continues to web search / general reasoning. Web results
never become knowledge without governance.

### D-RETR-1 — Reuse the existing pgvector store and `VectorRepository`
No Pinecone/Weaviate/Qdrant/pgvector-alternative. All vector SQL stays in
`VectorRepository`; K1 adds only a parameterized `scope`/`visibility` filter.

### D-RETR-2 — Keep `gemini-embedding-001` @ 768-d
Switching embedding model = full re-embed of every chunk + a schema change.
Out of scope. `Knowledge.provider` records the embedder for a future
migration.

### D-RETR-3 — No reranker in beta
Deterministic weighted rank (`similarity × authorityWeight − stalePenalty`).
Reranker is a flagged K8+ option.

### D-RETR-5 — Answer cache = Postgres table, not KV
No shared KV store exists on the current Vercel plan. `KnowledgeAnswerCache`
is a Postgres table for beta. Migrating to Vercel KV / Upstash is a
post-beta optimisation, not a blocker.

### D-CONTRACT-4 — Lifecycle mapping
8 canonical states → `CandidateStatus` (`candidate`, `under_review`,
`approved`, `rejected`, `duplicate`, `superseded`) + `KnowledgeStatus`
(`draft`, `active`, `deprecated`, `archived`). `APPROVED`+`ACTIVE` collapsed;
the approval *event* is the `AuditLog` row + `approvedAt/By`.

### D-CONTRACT-5 — 6-type taxonomy
`product` · `platform` · `trading_education` · `policy` · `support` · `faq`.
Provenance (`sourceType`) is tracked separately from subject (`knowledgeType`).

### D-GOV-1 — Reuse `AuditLog` + `requireAdmin`; approval is human-only
No new audit model. No auto-approval, no confidence threshold, no agent
caller (AN1.9 `approvePending` rule). Governance functions are server-only,
never exported to an agent tool or the client bundle.

### D-ANALYTICS-1 — Internal only
`AnalyticsEvent` + `KnowledgeRetrievalLog`. No Segment/Amplitude. Store
`queryHash`, never raw query text, in the analytics table.

### D-SUPPORT-1 — One shared foundation, `scope`-namespaced
The AI Assistant and the future Chat Support Agent read the same store,
filtered by `scope` (`assistant` / `support` / `shared`). Building a second
RAG for Support is prohibited (sprint §24).

### D-NODEP — No new third-party dependencies
No Tavily, Exa, Brave, Pinecone, Weaviate, Qdrant, LangChain, LlamaIndex,
`@ai-sdk/*`, or a new analytics/cache SaaS. The only new *external surface*
is `ANTHROPIC_API_KEY` against an API the project already has a client for.

---

## 4. PENDING — owner sign-off required before the affected step

### PENDING-1 — Claude as primary + Claude Native Web Search  *(affects K3; ties to D-ORCH-2)*
**Recommendation:** provision `ANTHROPIC_API_KEY`; promote Claude to the
preferred provider slot; extend `ClaudeProvider` to pass
`tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]`
and parse the result blocks. Keep the full fallback chain
(Claude → Gemini → OpenAI → deterministic) unchanged. **Risk if not signed
off:** the Knowledge Loop ships on Gemini + `googleSearch` (works today) and
"Claude primary" becomes a later swap — acceptable but not the brief's intent.
The owner must confirm: (a) an Anthropic API key/budget is available; (b)
Anthropic's web-search server tool pricing is acceptable; (c) Claude becomes
the default customer-facing assistant model.

### PENDING-2 — The `Knowledge` global-scope schema change  *(affects K1)*
**Recommendation:** additive columns on `Knowledge` (`scope`, `visibility`,
`knowledgeType`, `status`, `version`, `supersedesId`, `freshnessClass`,
`freshnessReviewEveryDays`, `expiresAt`, `lastReviewedAt`, `provenance`,
`confidence`, `sourceType`, `canonicalQuestion`, `canonicalAnswer`,
`approvedAt/By`, `deprecatedAt/By`, `lastRetrievedAt`) + new models
(`KnowledgeCandidate`, `KnowledgeAnswerProvenance`, `KnowledgeRetrievalLog`,
`KnowledgeAnswerCache`, `KnowledgeVersionCounter`). All nullable/defaulted, no
backfill. Migration **generated + hand-reviewed in K1, NOT applied** until a
separate explicit go-ahead (AN1.9 / M-series precedent). The owner must
confirm the additive-columns-on-`Knowledge` approach vs. a fully separate
`AssistantKnowledge` model (rejected — §5).

### PENDING-3 — Answer-cache store  *(affects K5)*
**Recommendation:** `KnowledgeAnswerCache` Postgres table for beta
(D-RETR-5). The owner may instead authorise a Vercel KV / Upstash add-on now
if they want the cache off the primary DB from day one. Low-risk either way;
the cache interface is identical.

### PENDING-4 — Candidate as a separate model vs. a `Knowledge` row in `candidate` status  *(affects K1/K4)*
**Recommendation:** **separate `KnowledgeCandidate` model.** It needs
conversation provenance, dedup fields, and a review workflow that don't belong
on a live knowledge row, and keeping unreviewed content out of the table the
retriever queries is defense-in-depth (AN1.9 precedent). The owner must
confirm — a single-table design is simpler but weaker.

---

## 5. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Dedicated vector DB (Pinecone / Weaviate / Qdrant) | pgvector + HNSW is already in production and adequate at this scale; sprint §24 forbids it; adds a SaaS dependency and a sync problem |
| Switch to a different / larger embedding model | full re-embed of every chunk + `vector(N)` schema change + drift risk; no evidence the current model is the bottleneck |
| Cross-encoder / LLM reranker in beta | second model call per turn; latency + cost; marginal gain at `topK = 12`; deferrable behind a flag |
| Separate `AssistantKnowledge` model (not additive to `Knowledge`) | forks the knowledge store the agent framework's `research.knowledge_search` tool and the existing dashboard already use; two retrievers, two ingestion paths, two truths; `scope` on one model achieves the same isolation |
| Tavily / Exa / Brave for web search | Claude's native `web_search` server tool covers it with zero new vendor; sprint §24 forbids introducing them "by default" |
| A second RAG for the Support Agent | sprint §18/§24 forbid it; `scope`-namespacing the shared store is the design |
| Auto-approve candidates above a confidence threshold | the entire point of the loop is *human-verified* knowledge; AN1.9 established "never silently promote"; a threshold is a hallucination pipeline |
| Vercel KV / Redis for the answer cache in beta | not on the current plan; a Postgres table is sufficient for beta volume and keeps the dependency count at zero |
| LLM-based intent classifier in beta | adds a model call before every turn; a disclosed heuristic (the codebase's established pattern) is enough; the interface lets it be swapped later |
| Storing raw query text in the analytics table | unnecessary PII duplication; `Message` already holds it; `queryHash` supports the gap/repeat metrics |
| Full 8-state lifecycle as literal enum values on one model | `APPROVED` and `ACTIVE` have no meaningful gap; collapsing them + an audit event is simpler and loses nothing |

---

## 6. Dependencies

| Dependency | Needed for | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` + budget | K3 (Claude primary + web search) | **NOT provisioned** — PENDING-1 |
| Anthropic web-search server-tool availability on the account tier | K3 | to verify with the key |
| `ClaudeProvider` tool-use extension | K3 | to build (small; REST, no SDK) |
| Migration apply authorization | K1 | gated (AN1.9 precedent) |
| `config/knowledge-loop.config.ts` (constants + cost rates) | K2+ | to create |
| `claude-api` skill consulted for model id / pricing / params | K3 | do before wiring |
| Existing: pgvector, `GeminiEmbeddingProvider`, `IngestionService`, `AuditLog`, `requireAdmin`, `AnalyticsEvent`, `AIPresenterOrchestratorService` | all steps | **present, reused** |
| Vercel one-cron/day budget | freshness sweep + purges | must share the single daily slot (`project_vercel_deployment_topology`) |

---

## 7. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| PII / secrets / account data leak from conversation into globally-retrievable knowledge | **High** | 4 locked layers (§1 Q16): privacy-class gate, two-point deterministic scanner, no user-scope auto-promote, human approval seeing the source |
| Hallucinated answer becomes a candidate then knowledge | **High** | integrity check before candidacy; human-only approval; no auto-approve; web-only answer needs `webSources`; deterministic fallback never fabricates |
| Stale `DYNAMIC` knowledge served as current | Medium | `expiresAt` required for `DYNAMIC`; excluded from retrieval when expired; daily sweep auto-deprecates; default is *don't store dynamic facts as knowledge* |
| Answer cache serves a wrong answer after a knowledge edit | Medium | `knowledgeVersionFingerprint` in every cache key → lazy invalidation on any lifecycle transition; TTL; never cache dynamic/user-specific/web-dependent |
| Claude / Anthropic web search unavailable or over budget | Medium | full fallback chain preserved (Gemini `googleSearch` still works); `webSearchRequestedButUnavailable` recorded, never fabricated; `WEB_SEARCH_MAX_USES` cap |
| `prisma migrate dev` run by mistake → pgvector reset | **High** (has happened before) | migration generated offline via `migrate diff`, header marks NOT APPLIED, applied only via `migrate deploy` under gate; documented in every migration header already |
| Retrieval cache incoherence on serverless (per-instance) | Low | it stores only chunk ids + scores; rows re-hydrated live with `status = 'active'`; short TTL; it's a latency optimisation, not a source of truth |
| `Knowledge` schema change breaks the existing per-user KB or the agent `research.knowledge_search` tool | Medium | all columns additive/nullable/defaulted; `scope = user` default preserves today's behaviour exactly; regression test #15 |
| Governance function reachable by an agent | Medium | server-only barrel; never imported by `services/agent-framework/*`; regression assertion (AN1.9 pattern) |
| Candidate backlog grows faster than admins review | Low/Med | dedup suppression; `Open Candidate Backlog` metric + oldest-age alert; candidate creation is conservative (only real gaps, not every turn) |
| Cost creep from web-search-heavy traffic | Medium | `WEB_SEARCH_MAX_USES = 3`; web-gate `webSearchForbidden` rules; answer cache; per-turn token/search estimate logged for the cost dashboard |
| Role vocabulary drift (`user` vs `customer` vs `lib/roles.ts`) causes an auth mistake | Low | governance keys only off `assertRole("admin")` (the correct, existing gate); drift documented, not touched |

---

## 8. Implementation order

| Step | Deliverable | Entry gate |
|---|---|---|
| **K1** | Migration (generated + reviewed, **not applied**); `KnowledgeStatus`/`KnowledgeScope`/… enums; additive `Knowledge` columns; `KnowledgeCandidate` + `KnowledgeAnswerProvenance` + `KnowledgeRetrievalLog` + `KnowledgeAnswerCache` + `KnowledgeVersionCounter` models; Knowledge Service (CRUD + lifecycle); `VectorRepository` scope/visibility filter | PENDING-2, PENDING-4 signed off |
| **K2** | Retrieval contract wired: embed → pgvector → filter → weighted rank → freshness → retrieval cache → `KnowledgeRetrievalLog` + hit/miss/low events | migration applied under authorization |
| **K3** | Orchestrator into `knowledge/chat` (behind the market-intelligence gate): classifier, web-search gate, Claude-preferred provider chain, `web_search` tool in `ClaudeProvider`, always-on `KnowledgeAnswerProvenance` | PENDING-1 signed off; `ANTHROPIC_API_KEY` provisioned; `claude-api` skill consulted |
| **K4** | Candidate generation (guarded, deduped) + admin queue (routes + minimal UI) + `Governance.approve/reject/defer` | governance review of the approval flow |
| **K5** | Answer cache (write conditions + version-fingerprint invalidation) + provenance completeness + `publishNewVersion` | PENDING-3 decided; cache-safety review |
| **K6** | Governance hardening (deprecate/archive/reinstate, freshness sweep, purges in the daily cron) + all 15 analytics events + read-only metrics dashboard | — |
| **K7** | End-to-end evaluation — the 15 acceptance tests (§9) as `scripts/validate-knowledge-loop-*.ts` | K1–K6 complete |
| **K8** | Beta hardening — latency/cost tuning, privacy-scan tightening from real data, load test, backlog triage | K7 pass |

---

## 9. Acceptance tests (proposed)

Standalone `scripts/validate-knowledge-loop-*.ts` harnesses (`node:assert/strict`
via `tsx`), one `validate:knowledge-loop-*` package script per area (AN1.2 D2
house style): deterministic fake inputs → real unmodified service chain →
assert → pass/fail.

1. Precedence — matching active knowledge answers from knowledge; no web search.
2. Threshold fallthrough — sub-`RELEVANCE_GOOD` hits → web/general reasoning; `KNOWLEDGE_LOW_RELEVANCE`.
3. Insufficient → web — 0 hits + current-info intent → web search; provenance records web sources.
4. Stale demotion — `DYNAMIC` past `expiresAt` never presented as current; orchestrator falls through.
5. Conflict (k-vs-k and k-vs-web) — both provenance kept; policy picks authoritative; `KNOWLEDGE_CONFLICT`; no silent mutation; candidate created.
6. Candidate creation — an answered how-to gap creates exactly one candidate with provenance; a market/dynamic question creates none; a PII turn creates none.
7. Dedup — a candidate `> DUP_HARD` to active knowledge attaches as duplicate, no competing row.
8. Approval — `approve()` creates one `active` `Knowledge`, runs ingestion (chunks + embeddings), writes one `AuditLog`, emits `KNOWLEDGE_APPROVED`, bumps the version fingerprint.
9. Rejection — a rejected candidate is never returned by retrieval, ever; `AuditLog` + `KNOWLEDGE_REJECTED`.
10. Retrieval safety — deprecated excluded; rejected unreachable; lower-confidence duplicate never outranks canonical; user-scoped rows never leak cross-user.
11. Cache safety — a `STATIC`/public answer caches and re-serves (`CACHE_HIT`); market/user-specific/web-dependent never cached; an approve invalidates the relevant cached answer on next request.
12. Provenance completeness — every answer writes a `KnowledgeAnswerProvenance` row with a correct deterministic `sourceClass`; `MIXED` carries per-source contribution.
13. Authorization — every admin route rejects a non-admin session; no knowledge/candidate mutation path exists without `requireAdmin`; governance functions not importable by an agent tool.
14. Shared foundation — a `support`-scoped query does not return `assistant`-only knowledge and vice versa; `shared` is visible to both.
15. Regression — existing `validate:*` suites pass; the non-streaming `knowledge/chat` contract is byte-identical for the publishing / trading-copilot / agent callers; the agent `research.knowledge_search` tool still works.

---

## 10. Acceptance criteria checklist (K0)

| # | Criterion | Status |
|---|---|---|
| 1 | Architecture is documented | ✅ [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md) |
| 2 | AT24 Knowledge-first precedence explicitly locked | ✅ D-CORE; architecture §1 |
| 3 | Claude integration boundary documented | ✅ orchestration §7; audit §1 Q1/Q3 |
| 4 | Claude Native Web Search fallback boundary documented | ✅ orchestration §5/§7.3; **mechanism pending PENDING-1** |
| 5 | Knowledge schema defined | ✅ [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) §2 |
| 6 | Candidate schema defined | ✅ `KNOWLEDGE_CONTRACT.md` §8 |
| 7 | Knowledge lifecycle defined | ✅ `KNOWLEDGE_CONTRACT.md` §4 |
| 8 | Approval contract defined | ✅ [`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md) §2 |
| 9 | Provenance contract defined | ✅ `KNOWLEDGE_CONTRACT.md` §3 + orchestration §8 (`KnowledgeAnswerProvenance`) |
| 10 | Semantic retrieval contract defined | ✅ [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) |
| 11 | Freshness rules defined | ✅ `KNOWLEDGE_CONTRACT.md` §5; retrieval §5 |
| 12 | Conflict resolution defined | ✅ retrieval §6; orchestration §6.2 |
| 13 | Cache strategy defined | ✅ retrieval §7; architecture §8 |
| 14 | Security / authorization model defined | ✅ governance §6/§7 |
| 15 | Analytics event contract defined | ✅ [`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md) |
| 16 | Support Agent shared-foundation boundary defined | ✅ D-SUPPORT-1; architecture §2 |
| 17 | Existing infrastructure reuse audited | ✅ architecture §9 |
| 18 | No unnecessary third-party dependency introduced | ✅ D-NODEP |
| 19 | Risks & mitigations documented | ✅ §7 |
| 20 | Implementation sequence documented | ✅ §8; architecture §11 |
| 21 | Acceptance tests proposed | ✅ §9; architecture §12 |
| 22 | Final GO / NO-GO documented | ✅ §11 |

---

## 11. Final K0 GO / NO-GO

```
R&D (20 questions):        PASS  — §1
ARCHITECTURE:              DOCUMENTED + PROPOSED FOR LOCK
KNOWLEDGE CONTRACT:        PROPOSED FOR LOCK
RETRIEVAL CONTRACT:        PROPOSED FOR LOCK
ORCHESTRATION CONTRACT:    PROPOSED FOR LOCK  (Claude-primary path = PENDING-1)
GOVERNANCE CONTRACT:       PROPOSED FOR LOCK
ANALYTICS CONTRACT:        PROPOSED FOR LOCK
INFRASTRUCTURE REUSE:      AUDITED  — pgvector, Gemini embeddings, IngestionService,
                                     AuditLog, requireAdmin, AnalyticsEvent,
                                     AIPresenterOrchestratorService all reused
NEW THIRD-PARTY DEPS:      NONE  (only ANTHROPIC_API_KEY against an existing client)
OPEN DECISIONS:            PENDING-1 (Claude primary + web search)
                           PENDING-2 (Knowledge additive-schema change)
                           PENDING-3 (answer-cache store)
                           PENDING-4 (candidate as separate model)

K0 DECISION:               GO — for the architecture and contract LOCK.

K1 START:                  CONDITIONAL GO — begins once PENDING-2 and PENDING-4
                           are signed off. K3 additionally requires PENDING-1
                           and a provisioned ANTHROPIC_API_KEY. No migration is
                           applied until the separate apply-authorization gate.

IMPLEMENTATION SCOPE:      the smallest correct foundation for beta — no admin
                           shell, no reranker, no vector DB, no second RAG, no
                           auto-approval, no speculative features.
```

The system becomes smarter over time **through verified knowledge, not through
uncontrolled self-training.**

---

## 12. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0_DECISION created. 20 R&D questions answered (§1). 11 decisions proposed for lock (§3). 4 pending owner sign-off (§4). 12 alternatives rejected (§5). GO for architecture lock; conditional GO for K1 (§11). |
