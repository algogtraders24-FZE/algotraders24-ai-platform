# K3-A — Provider / API Preflight

**Sprint:** K3 — AI Assistant Orchestration (Knowledge-First Gate)
**Stage:** K3-A — read-only provider/API audit. **Zero production code changes. No migration. No `ANTHROPIC_API_KEY` in any file, log, commit, or this document.**
**Base:** `origin/main` @ `6ad50cb` (K2 operationally complete).
**Depends on / implements:** [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md) · [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) · [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) · [`K1_DECISION.md`](K1_DECISION.md) (SO-1) · [`K2_ACCEPTANCE.md`](K2_ACCEPTANCE.md)
**Method:** fresh audit of the *current* Anthropic Messages API (official docs, 2026‑09, via the `claude-api` skill + `platform.claude.com/docs`) — **not** the K0 research snapshot — plus a line read of the real `main`‑branch code.

> **Bottom line:** the K3 gate is **buildable and low‑risk at the code/design level (GO)**. It is **NOT yet live‑provider ready (NO‑GO)** — that requires the owner to (a) provision `ANTHROPIC_API_KEY` via the deployment secret store and (b) confirm the Anthropic org has web search enabled. See §9.

---

## 1. API findings — the K0 snapshot is stale

K0 (`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §7.3, `K1_DECISION` SO‑1) referenced
`web_search_20250305` and `claude-sonnet-4-5`. Current state (verified against
`https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool`
and the bundled `claude-api` skill, cache 2026‑06‑24):

### 1.1 Models

| Item | K0 snapshot | **Current** |
|---|---|---|
| Assistant model default (`ANTHROPIC_MODEL` in `lib/ai/env.ts`) | `claude-sonnet-4-5` | **stale** — not in the current model table. Current IDs: `claude-opus-5` ($5/$25 per 1M, 1M ctx), **`claude-sonnet-5` ($2/$10, 1M ctx)**, `claude-haiku-4-5` ($1/$5, 200K). |
| Recommendation for the AT24 beta assistant | — | **`claude-sonnet-5`** — strong, cheapest 1M‑context tier, and it supports the modern `web_search_20260209`. `claude-opus-5` is the upgrade if answer quality on hard platform/trading questions proves insufficient in K7. Model is env‑driven (`ANTHROPIC_MODEL`), so this is a config value, not a code decision. |
| Model‑string hygiene | — | Use the exact ID string, **never append a date suffix** (`claude-sonnet-5`, not `claude-sonnet-5-2026...`). |
| Prefill | (n/a) | **Removed** on Sonnet 5 / Opus 5 / the 4.6+ family — a last‑assistant‑turn prefill returns 400. `ClaudeProvider` does not prefill → no impact. |
| Thinking | (n/a) | Sonnet 5: `thinking:{type:"adaptive"}` is the only on‑mode; omitting runs adaptive. For a **chat assistant**, `output_config:{effort:"low"}` (or `"medium"`) is the right cost/latency setting — the skill explicitly notes chat/classification "do well at low". `budget_tokens` is **rejected with a 400** on Sonnet 5 / Opus 5. |
| `max_tokens` | `ClaudeProvider` default `2048` | Too low for a synthesised answer that folds in web results. Raise to **~4096** (non‑streaming chat). The skill's non‑streaming default guidance is ~16000; 4096 is a deliberate cost cap for short chat answers. |

### 1.2 Native web search (server tool)

| Item | K0 snapshot | **Current** |
|---|---|---|
| Tool `type` | `web_search_20250305` | Three versions: **`web_search_20250305`** (basic, every model), **`web_search_20260209`** (adds *dynamic filtering* — runs code‑exec under the hood to pre‑filter results; 4.6+ models), `web_search_20260318` (adds `response_inclusion`). |
| Beta header | (K0 assumed one might be needed) | **None.** All web‑search versions are GA on `anthropic-version: 2023-06-01`. No `anthropic-beta` header. |
| Availability on the **first‑party Claude API** (`api.anthropic.com`, which AT24 uses) | (K0 flagged "to verify") | **GA ("Yes").** Web search is *enabled for the org by default* unless an admin disabled it in the Console. If disabled → the request 400s with `invalid_request_error` ("web search is not enabled"), **not** an in‑result error code. **→ the one account‑level thing the owner must confirm (§8).** |
| `allowed_callers` | (n/a) | On `web_search_20260209`+ defaults to `["code_execution_20260120"]` (dynamic filtering). To call **directly** (simplest — no code‑exec environment): `web_search_20250305` (default direct) **or** `web_search_20260209` + `allowed_callers:["direct"]`. |
| Tool params | (n/a) | `max_uses` (cap searches/turn), `allowed_domains` **xor** `blocked_domains` (bare hostnames, no scheme; both → 400), `user_location` (`{type:"approximate", city?, region?, country?(ISO‑2), timezone?(IANA)}`). |
| Response blocks (in order) | K0: "parse `server_tool_use` / `web_search_tool_result`" | ✔ confirmed: `text` (search decision) → `server_tool_use` (`{id, name:"web_search", input:{query}}`) → `web_search_tool_result` (`{tool_use_id, content}`) → `text` blocks carrying `citations[]`. |
| `web_search_result` fields | (n/a) | `url`, `title`, `page_age` (str, e.g. "April 30, 2025"), **`encrypted_content`** (opaque; **must be echoed back verbatim** on any multi‑turn continuation or the next request 400s). |
| Citations | (n/a) | Always on for web search. Each cited `text` block has `citations:[{type:"web_search_result_location", url, title, encrypted_index, cited_text (≤150 chars)}]`. `cited_text`/`title`/`url` **do not count toward tokens**. **Anthropic ToS: citations must be shown to end users when API output is displayed directly.** |
| Errors | K0: "handle gracefully" | **HTTP 200** with `web_search_tool_result.content` = a single `{type:"web_search_tool_result_error", error_code}` object (not a list). Codes: `too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large`, `unavailable`. A success with no matches → empty `content` list. **A failed search is not billed.** |
| `pause_turn` | (K0 not mentioned) | A long search turn can return `stop_reason:"pause_turn"`. To continue: **resend the paused assistant message unchanged** (do NOT add a "continue" user turn — the server detects the trailing `server_tool_use`). Cap with a `max_continuations` (≈3–5). |
| `stop_reason:"tool_use"` | (n/a) | Only if Claude mixes web_search with a *client* tool in one parallel group. **K3 defines no client tools → this never happens.** |
| Pricing | K0: "flag as risk" | **$10 per 1,000 web searches**, plus standard token cost for the search content (counted as input tokens in that turn **and every later turn** it stays in context). `usage.server_tool_use.web_search_requests` reports the count per response. |
| Streaming | (n/a) | Search events stream; there is a visible pause while the search runs. |

### 1.3 SDK vs raw REST

- **No official Anthropic SDK is installed.** `frontend/package.json` has `@google/genai` only. `ClaudeProvider` and `OpenAIProvider` are **hand‑rolled REST via an injectable `fetch`** — the same "no SDK, injectable transport" pattern as `AngelOneProvider` / `BinanceProvider`.
- **`K1_DECISION.md` SO‑1 LOCKED this:** *"`ClaudeProvider` … is extended to pass a `tools` array and parse `server_tool_use` / `web_search_tool_result` content blocks — REST, no `@anthropic-ai/sdk`, injectable `fetch` (the file's existing convention)."*
- The `claude-api` skill's default is "use the official SDK where one exists". **Assessment:** the locked SO‑1 decision + the established project convention win here. The web‑search wire contract is plain JSON (documented in §1.2); a hand‑rolled REST extension of the existing `ClaudeProvider` is small, testable against injected fixtures (the project's existing test style), and keeps the dependency count and bundle size unchanged. **Recommendation: keep REST, do not add `@anthropic-ai/sdk` in K3.** If the owner later wants the SDK for streaming/tool‑runner ergonomics, that is a separate, isolated decision — the `AIProvider` interface would absorb it without touching callers.
- **Auth:** header `x-api-key: <ANTHROPIC_API_KEY>` (not OAuth) — exactly what `ClaudeProvider` already sends. Nothing changes here.

---

## 2. Current‑code findings (`main` @ `6ad50cb`)

### 2.1 `lib/ai/providers/claude.provider.ts`

- REST `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, `x-api-key`. Injectable `ClaudeFetch`.
- `complete(req)` request body: `{model, max_tokens (default 2048), temperature?, system?, messages}`. **No `tools`.**
- Response parsing: filters `content[]` to `type === "text"` and joins. **Ignores every other block type** (`server_tool_use`, `web_search_tool_result`, `tool_use`, `thinking`).
- No `stop_reason` inspection → **no `pause_turn` handling**.
- `!res.ok` → `AIProviderError`. Does **not** know that a web‑search error arrives as HTTP 200.
- `splitSystem()` folds system‑role messages into the top‑level `system` field (correct for Anthropic).
- Header comment already says: *"No real `ANTHROPIC_API_KEY` exists in this project — untested against the live API."*

### 2.2 `lib/ai/{provider.interface,types,env,errors}.ts`

- `AIProvider.complete(req: AICompletionRequest): Promise<AICompletionResponse>`. Interface comment: *"Streaming & tool‑calling intentionally omitted (added later, no break)."*
- `AICompletionRequest`: `{messages, model?, temperature?, maxTokens?}` — **no `tools`, no `webSearch` flag**.
- `AICompletionResponse`: `{content, model, provider, usage?, latencyMs?}` — **no way to return web sources / citations / search count**.
- `loadAnthropicEnv()`: reads `ANTHROPIC_API_KEY` (throws if missing) + `ANTHROPIC_MODEL` (default `claude-sonnet-4-5` — **stale, see §1.1**).
- `AIErrorKind`: `auth | rate_limit | network | timeout | invalid_input | invalid_output | invalid_dimensions | unknown`.

### 2.3 `services/intelligence/chat/ai-presenter-orchestrator.service.ts` + `gemini-intelligence-presenter.service.ts`

- **This is the MARKET‑INTELLIGENCE presenter chain, not the general chat path.** Its slots: `gemini → claude → openai → DeterministicSafeFallbackPresenter`, each wrapping a provider in `GeminiIntelligencePresenter` (which is provider‑generic despite its name).
- Slot pattern: `{name, isAvailable: () => hasEnv("<KEY>"), createPresenter}`. `isAvailable` is a cheap `process.env` presence check — a provider constructor is **never** called for a missing key. On any per‑provider failure (throw, empty text, integrity‑rejection) the loop moves to the next slot. If all fail → `DeterministicSafeFallbackPresenter` (never fabricates).
- `GeminiIntelligencePresenter.present(envelope, userQuestion)` calls `provider.complete({messages})` with **no tools** and a hard "present only verified facts, no web access" system instruction (sprint §9 comment: *"never web access"*). It is bound to an `IntelligenceEnvelope`.
- Each candidate is checked by `validateResponseIntegrity(text, envelope, decisionContext, microstructure)` — **envelope‑specific**, not a general‑knowledge validator.

### 2.4 `app/api/private/knowledge/chat/route.ts` — the Assistant entrypoint

Flow (unchanged since K0):

```
POST /api/private/knowledge/chat   (session auth via getUserOrNull)
  → conversation identity + persist the user turn (ConversationMessageService)
  → MARKET‑INTELLIGENCE GATE:
        intelligencePresentationService.present({requestId, userId, message, conversationId, symbol, includeMicrostructure:true})
        · status "resolved"           → intelligenceAnswer = presented.text  → RETURN / STREAM, DONE
        · "insufficient-data"          → deterministic "couldn't confirm" msg → DONE
        · "clarification-required"     → clarification msg → DONE
        · anything else (no instrument resolved — the ordinary case)  → FALL THROUGH ↓
  → INLINE RAG:  GeminiEmbeddingProvider.embed(query)
                 + RepositoryFactory.vectors().searchSimilar({embedding, topK:5, userId, knowledgeId})
                 + MIN_SIMILARITY 0.3, MAX_CONTEXT_CHARS 6000, real doc titles for a Sources panel
  → buildContext({ systemInstructions: AI_COMMUNICATION_POLICY [+ RAG_SYSTEM_INSTRUCTIONS], ragContext, recentMessages, userMessage })
  → GoogleGenAI DIRECTLY (Gemini 2.5 Flash + { tools:[{googleSearch:{}}] } when needsLiveInfo(query))
  → NDJSON stream: {type:"stage"} , {type:"token"} … , {type:"done", conversationId, ragApplied, sources}
                   (non‑stream path = one blocking ApiResponse.success with the same shape — byte‑for‑byte for the publishing/copilot/agent callers)
```

**Key architectural fact for K3:** the *general chat* path has **no provider abstraction** — it is a raw `GoogleGenAI` call with `googleSearch`. It does **not** use `AIPresenterOrchestratorService`. So "Claude primary + native web search" for the Knowledge Loop is a change to *this* path, and the K0 line "reuses `AIPresenterOrchestratorService`'s exact slot mechanism" means *the same pattern*, in a **new** knowledge‑answer orchestrator — not that literal (envelope‑bound) service.

### 2.5 K1/K2 substrate (the part K3 consumes, unchanged)

- `services/knowledge-loop/knowledge/` — `createKnowledgeService({ withRetrievalCache })` → `KnowledgeService`.
- `KnowledgeService.retrieve(query, { callerUserId, callerRole, scopes, topK?, knowledgeId?, includeUserScope?, conversationId? })` → `RetrievalResult { hits[], contextBlock, sufficiency: "SUFFICIENT"|"LOW"|"INSUFFICIENT"|"STALE", bestSimilarity, fromCache, latencyMs, reason }`.
- Postgres retrieval cache live (K2, migration applied). `KnowledgeRetrievalLog` emit is wired. Freshness sweep exists as a function.
- **`KnowledgeAnswerProvenance` Prisma model exists (K1) with NO writer yet** — K3 is its first writer (`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §8).
- `KnowledgeCandidate` model + INV‑1 intact. No candidate *service* yet (K4).
- `lib/ai/response-policy.ts` `AI_COMMUNICATION_POLICY` + `lib/ai/compliance.ts` `scanForForbiddenLanguage` + `lib/ai/terminology.ts` forbidden‑phrase list — the **general** wording/compliance guardrails K3 should apply to every Claude answer (the `validateResponseIntegrity` envelope validator in §2.3 is *not* the right tool for general knowledge answers).

---

## 3. Contract ↔ code mismatches (what K3‑B must bridge)

| # | Contract expectation (`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`) | Current code | Bridge (K3‑B) |
|---|---|---|---|
| M‑1 | §7.1 Claude‑preferred provider chain "reuses `AIPresenterOrchestratorService`'s exact slot mechanism". | That service is `IntelligenceEnvelope`‑bound (market intel). The general chat path is a raw `GoogleGenAI` call, no abstraction. | New `KnowledgeAnswerOrchestrator` in `services/knowledge-loop/orchestrator/` — **same slot pattern** (`{name, isAvailable, create}`, fall‑through, deterministic fallback) but `present(knowledgeContext, query, history, webSearchEnabled)` shaped for knowledge answers. The market‑intel `AIPresenterOrchestratorService` is **not touched**. |
| M‑2 | §7.3 `ClaudeProvider` passes `tools:[web_search…]` and parses `server_tool_use` / `web_search_tool_result`. | `ClaudeProvider.complete()` sends no `tools`, parses only `text` blocks, no `pause_turn`, treats HTTP‑200 web errors as success‑with‑empty‑text. | Additive: `AICompletionRequest` gains `tools?` + a typed `webSearch?` option; `AICompletionResponse` gains `webSources?` + `searchCount?` + `stopReason?`; `ClaudeProvider` gains a `pause_turn` continuation loop (cap 3), web‑result‑block parsing (list vs error‑object branch), and `encrypted_content` pass‑through on continuation. **All optional → Gemini/OpenAI unaffected.** |
| M‑3 | §8 every answer writes `KnowledgeAnswerProvenance` with a deterministic `sourceClass` (`AT24_KNOWLEDGE` / `CLAUDE_REASONING` / `CLAUDE_WEB_SEARCH` / `MIXED`) + per‑source contribution. | Model exists, no writer. Chat route writes only a coarse `AnalyticsEvent("ai_chat")`. | `KnowledgeAnswerOrchestrator` writes it best‑effort (same `.catch(()=>{})` convention as every other persistence in the route). |
| M‑4 | §3 heuristic classifier (`intent` / `freshnessNeed` / `privacyClass` / `explicitFreshnessRequest`). | `services/ai/assistant.service.ts` has the *disclosed heuristics* `detectSupportedMarketSymbol` + `needsLiveInfo` (client‑side). No server classifier. | New `services/knowledge-loop/classifier/` — disclosed heuristic, server‑side, reusing the `needsLiveInfo`‑style regexes. Not an LLM call (K0 §3, K1_DECISION D‑9 spirit). |
| M‑5 | §5 web‑search gate: `webSearchRequired` (explicit freshness / DYNAMIC need / retrieval INSUFFICIENT|STALE / unresolved conflict) AND NOT `webSearchForbidden` (sensitive privacyClass / account‑specific / conceptual+SUFFICIENT). | Chat route's `needsLiveInfo(query)` is the only gate; it's coarse and doesn't consider retrieval sufficiency. | The gate is a pure function in the orchestrator consuming `RetrievalResult.sufficiency` + the classifier output. |
| M‑6 | §1 the K3 gate sits **after** the existing market‑intelligence gate and runs for every non‑market turn; existing behaviour preserved outside the gate; non‑stream contract byte‑identical for publishing/copilot/agent callers. | Market‑intel gate + inline RAG+Gemini are both in the route. | The route change is: after the market‑intel gate, replace the inline RAG+Gemini block with `KnowledgeAnswerOrchestrator.answer(turn)`. NDJSON stream shape + non‑stream envelope unchanged. Gemini + `googleSearch` becomes the **fallback provider's own** mechanism, not the primary. |
| M‑7 | §7.1 fallback chain `Claude → Gemini → OpenAI → deterministic` preserved. | Market‑intel chain is `Gemini → Claude → OpenAI → deterministic`. The general chat path has no chain. | K3's knowledge chain is `Claude → Gemini(+googleSearch) → OpenAI → deterministic("I couldn't retrieve a verified answer")`. The market‑intel chain's order is **not changed** (that's a separate concern; SO‑1's "Claude preferred" is about the customer‑facing assistant). |
| M‑8 | §7.2 `account-specific` intent never sent to an LLM as free text; §9 candidate proposal guarded (never for `privacyClass ≠ public`, `DYNAMIC`, failed integrity, `account-specific`). | n/a (no such path). | Orchestrator branches: `account-specific` → deterministic pointer sourced from `platform` knowledge (or a K‑series follow‑on); candidate proposal is a guarded best‑effort call, **no `CandidateService` in K3** — K3 emits the *proposal intent*; the actual `KnowledgeCandidate` write + dedup is K4. (K0 §9 assigns candidate creation to the orchestrator, but the *service* is K4 — K3 can either stub the call or defer the whole candidate hook to K4. **Recommend: defer candidate creation entirely to K4**; K3 writes provenance only. This keeps K3 to "connect Claude + knowledge‑first + web gate + provenance".) |

None of these mismatches is a blocker — every bridge is additive and local to `services/knowledge-loop/**`, `lib/ai/{types,provider.interface,claude.provider}.ts`, and one edit to the chat route.

---

## 4. Minimal file‑level implementation plan (for the K3‑B prompt)

### 4.1 `lib/ai` — additive provider extension (SO‑1)

| File | Change |
|---|---|
| `lib/ai/types.ts` | `AICompletionRequest` += `tools?: AIToolSpec[]`. `AICompletionResponse` += `webSources?: AIWebSource[]`, `searchCount?: number`, `stopReason?: string`. New `AIToolSpec` (`{kind:"web_search"; maxUses?; allowedDomains?; blockedDomains?; userLocation?}`) and `AIWebSource` (`{url; title; pageAge?; encryptedContent; citedTexts: string[]}`). |
| `lib/ai/env.ts` | `loadAnthropicEnv()` default model → `claude-sonnet-5` (config value; the owner overrides via `ANTHROPIC_MODEL`). |
| `lib/ai/providers/claude.provider.ts` | When `req.tools` includes a `web_search` spec: add `tools:[{type:"web_search_20250305", name:"web_search", max_uses:…, allowed_domains/blocked_domains?, user_location?}]` to the body. Parse `content[]` for `server_tool_use` + `web_search_tool_result` (branch: `Array.isArray(content)` = results, else `{error_code}` → treat as "search unavailable, answer from knowledge/reasoning", never throw). Collect `web_search_result_location` citations onto `webSources`. `stop_reason:"pause_turn"` → resend `{role:"assistant", content: <blocks verbatim, incl. encrypted_content>}` (cap 3 continuations). Populate `usage.server_tool_use.web_search_requests` → `searchCount`. **Everything guarded by `req.tools?` — a call with no tools is byte‑identical to today.** |
| `lib/ai/providers/{gemini,openai}.provider.ts` | **Untouched** — they ignore `req.tools` (Gemini's `googleSearch` stays wired at the chat‑route fallback level, or optionally via a `gemini` `web_search` spec later — out of K3 scope). |
| `config/knowledge-loop.config.ts` | += `ORCHESTRATOR` block: `CLAUDE_MAX_TOKENS: 4096`, `CLAUDE_EFFORT: "low"`, `WEB_SEARCH_MAX_USES: 3`, `WEB_SEARCH_MAX_CONTINUATIONS: 3`, `HISTORY_TURNS: 8`. |

### 4.2 `services/knowledge-loop/` — the gate (new)

```
services/knowledge-loop/
  classifier/
    classify.ts            heuristic: intent | freshnessNeed | privacyClass | explicitFreshnessRequest  (no LLM)
  orchestrator/
    ports.ts               AnswerProviderPort (present(ctx)→{text, sourceClass, providerUsed, webSources, ...}), ProvenanceStorePort
    web-search-gate.ts      pure: gate(classification, retrievalSufficiency) → { useWebSearch, reason }
    knowledge-answer-orchestrator.ts
                            answer(turn) = classify → KnowledgeService.retrieve (scopes ["assistant","shared"])
                                         → web-search gate → build Claude context (AI_COMMUNICATION_POLICY + knowledge block + history)
                                         → provider chain [Claude(+web_search) → Gemini(+googleSearch) → OpenAI → deterministic]
                                         → scanForForbiddenLanguage on the winner
                                         → write KnowledgeAnswerProvenance (sourceClass, contributions, providerAttempts, latency)
                                         → return { text, sources, sourceClass, ... }
    provenance-store.ts     Prisma writer for KnowledgeAnswerProvenance (best-effort)
    in-memory-adapters.ts   offline test doubles (fake provider, fake provenance store)
    index.ts                server-only barrel + createKnowledgeAnswerOrchestrator()
```

### 4.3 `app/api/private/knowledge/chat/route.ts` — one edit

After the market‑intelligence gate's `if (intelligenceAnswer !== undefined) { … }` block, replace the **inline RAG + `GoogleGenAI`** section with:

```
const result = await knowledgeAnswerOrchestrator.answer({
  requestId: ctx.requestId, userId, callerRole: sessionUser.profile.role,
  conversationId, message: query, history: recentMessages, symbol: requestedSymbol,
});
// then the EXISTING NDJSON stream / non-stream envelope, populated from `result`
```

Streaming: for K3‑B v1, the orchestrator returns the **complete** answer and the route emits it as one `{type:"token"}` event (exactly how the market‑intel branch already does it — see route L329‑335). True token streaming from Claude is a **K3‑B follow‑on / K8** (needs `ClaudeProvider.stream()`), explicitly out of the minimal plan.

### 4.4 What K3‑B does NOT build

Candidate creation/dedup (K4) · admin queue (K4) · answer cache (K5) · analytics‑event finalisation (K6) · token‑by‑token Claude streaming (K8) · any change to `AIPresenterOrchestratorService` / market‑intel path / `assistant.service.ts` client heuristics.

---

## 5. Environment / deployment‑secret checklist (OWNER — not doable by the coding agent)

| # | Item | Who | Notes |
|---|---|---|---|
| E‑1 | An Anthropic **Console account / org** with API access and billing. | Owner | Web search billed at **$10 / 1,000 searches** + token cost. |
| E‑2 | **Web search enabled** for the org (Console → Settings → Privacy). Default is *enabled*; confirm an admin hasn't disabled it. Optionally set org‑level allowed domains. | Owner | If disabled, K3's web‑search turns 400 — the orchestrator must (and will) fall through to Gemini+googleSearch, but the "Claude native web search" objective isn't met. |
| E‑3 | `ANTHROPIC_API_KEY` created in the Console, added to **Vercel project env** (`algotraders24-ai-platform`, Production + Preview) via the Vercel dashboard / `vercel env add`. **Never committed. Never in a `.env` that is tracked. Never logged.** | Owner | The code already reads `process.env.ANTHROPIC_API_KEY` (`loadAnthropicEnv`). |
| E‑4 | Optional: `ANTHROPIC_MODEL` env (defaults to `claude-sonnet-5` after the E‑1 code change). Set to `claude-opus-5` to upgrade. | Owner | Config, not code. |
| E‑5 | Confirm the org's **web‑search rate limit** (Console → Rate limits) is adequate for expected beta chat volume. | Owner | Batches API throttles web search harder; the chat route is not batched. |
| E‑6 | A local `ANTHROPIC_API_KEY` in the **worktree `.env.local` only** (git‑ignored) for the K3‑B live smoke — same handling as the K1‑F / K2‑gate smokes (temp, never committed). | Owner → agent | The K3‑B live smoke needs a real key + a controlled temp conversation; cleanup mandatory. |

---

## 6. Testing / live‑smoke plan (K3‑B)

### 6.1 Offline (no key, no network) — house style `scripts/validate-knowledge-loop-*.ts`

- `validate:knowledge-loop-classifier` — intent / freshnessNeed / privacyClass / explicit‑freshness on a table of fixtures.
- `validate:knowledge-loop-websearch-gate` — the pure gate over `{classification × retrievalSufficiency}` truth table (require, forbid, and the "uncertain → err toward search" default).
- `validate:knowledge-loop-orchestrator` — with an **in‑memory `KnowledgeService`** + a **fake `AnswerProviderPort`**:
  - knowledge‑first: a SUFFICIENT retrieval → answer from knowledge, provider called with the knowledge block, **web search NOT requested**, `sourceClass = AT24_KNOWLEDGE`.
  - INSUFFICIENT + current‑info intent → web search requested; `sourceClass = CLAUDE_WEB_SEARCH`; provenance records `webSources`.
  - MIXED: both knowledge + web contributed → `sourceClass = MIXED`, per‑source `usedInAnswer` recorded.
  - fallback: fake Claude throws → Gemini slot used; fake all‑throw → deterministic "couldn't retrieve a verified answer", never fabricated.
  - forbidden‑phrase scan rejects a "buy now" answer → next slot.
  - `account-specific` / `privacyClass=sensitive` → web search forbidden; no candidate proposal; not cached.
  - every path writes exactly one `KnowledgeAnswerProvenance` (fake store) with a deterministic `sourceClass`.
- `validate:knowledge-loop-claude-provider` — `ClaudeProvider` against **injected fixture HTTP responses** (the project's existing `ClaudeFetch` double pattern): a plain text answer; a `web_search_tool_result` list → `webSources` populated + citations; a `web_search_tool_result_error` object → no throw, `webSources` empty; a `pause_turn` → one continuation then `end_turn`; a no‑tools request → body has no `tools` key (backward‑compat).
- **Regression:** existing `validate:*` green; `validate:ai-presenter-orchestration` unchanged; `knowledge/chat` non‑stream contract byte‑identical (assert the publishing/copilot/agent call shape).

### 6.2 Live smoke (K3‑B, needs `ANTHROPIC_API_KEY` in a worktree `.env.local`, temp data, full cleanup — K1‑F / K2‑gate discipline)

1. **Provider reachability** — one trivial `ClaudeProvider.complete({messages:[{role:"user",content:"reply with the single word: ok"}]})` → `content` contains "ok", `usage` present. Confirms key + model + network.
2. **Native web search live** — `ClaudeProvider.complete({ messages:[…"what is the latest stable Node.js LTS version"], tools:[{kind:"web_search", maxUses:2}] })` → response has ≥1 `web_search_tool_result` with a non‑empty result list, `searchCount ≥ 1`, `webSources[].encryptedContent` present, ≥1 citation. Confirms E‑2 (web search enabled on the org).
3. **Knowledge‑first end‑to‑end** — seed one temp `assistant`‑scope `Knowledge` row (tagged), ask a question it answers → orchestrator returns `sourceClass = AT24_KNOWLEDGE`, no web search fired, `KnowledgeAnswerProvenance` row written with the chunk contribution. Delete the temp rows.
4. **Web fallback end‑to‑end** — ask a current‑info question with no matching knowledge → `sourceClass = CLAUDE_WEB_SEARCH`, provenance has `webSources`, answer carries citations.
5. **Provider‑down fallback** — temporarily point `ANTHROPIC_MODEL` at a bogus id (or unset the key for one call) → orchestrator falls to Gemini, still answers, provenance `providerUsed = "gemini"`. Restore.
6. **Cost check** — record `searchCount` + token usage from steps 2 & 4; sanity‑check against the $10/1k + token math.
7. **Cleanup** — every tagged `Knowledge`/`KnowledgeChunk`/`KnowledgeAnswerProvenance`/`KnowledgeRetrievalLog`/`Conversation`/`Message` row hard‑deleted; verify 0 remain.

---

## 7. Risks & unresolved dependencies

| Risk | Severity | Mitigation |
|---|---|---|
| `ANTHROPIC_API_KEY` not yet provisioned; account web‑search status unconfirmed. | **Blocker for live‑provider GO** | §5 checklist. Code/design GO does not depend on it. |
| Web search adds real $ per turn ($10/1k searches + result tokens carried forward). | Medium | `WEB_SEARCH_MAX_USES = 3`; the gate forbids search for conceptual/SUFFICIENT turns; `HISTORY_TURNS = 8` caps carried context; provenance logs `searchCount` for a K6 cost dashboard. |
| `pause_turn` + `encrypted_content` echo‑back correctness — easy to get subtly wrong; a malformed continuation 400s. | Medium | Isolated in `ClaudeProvider`; fixture‑tested offline (6.1); continuation cap 3; on any parse failure, fall through to the next provider (never a user‑visible error). |
| Non‑streaming Claude answer → the chat UI shows a longer "thinking" pause than today's token stream. | Low | v1 emits the full answer as one token event (identical to today's market‑intel branch). Real streaming is K8. `effort:"low"` keeps Sonnet 5 chat latency to a few seconds. |
| K0 orchestration contract assigns candidate creation to the orchestrator, but `CandidateService` is K4. | Low | K3‑B writes provenance only; the candidate hook is deferred to K4 (recommended in M‑8). A one‑line ADR in `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` records the split. |
| The market‑intelligence path also has a Claude slot (`gemini → claude → openai`). SO‑1 says "Claude preferred" — does that re‑order the market‑intel chain too? | Low | **Out of K3 scope.** SO‑1 / the K0 orchestration contract is about the *customer‑facing knowledge assistant*. The market‑intel presenter chain is a separate D2.6.8 concern; leave its order untouched. Flag for owner if they want it revisited. |
| `@google/genai` is the only AI dep; adding web‑source/citation types touches `lib/ai/types.ts` which many files import. | Low | All additions are optional fields → structurally non‑breaking; `tsc` will confirm. |
| Anthropic API drift between now and K3‑B. | Low | K3‑B re‑checks `web-search-tool.md` at implementation time (this doc's §1 is dated 2026‑09). |

---

## 8. Account / tier requirements for native web search (summary)

- **First‑party Claude API (`api.anthropic.com`) — GA, no beta header, no special tier.** Web search is on by default for every org unless an admin disabled it in the Console.
- Billed **$10 / 1,000 searches** + standard token cost for search content.
- Works on any current model with `web_search_20250305`; `web_search_20260209` (dynamic filtering) needs a 4.6+ model (Sonnet 5 qualifies).
- **The single owner action that gates the "native web search" objective:** confirm web search is *not* disabled for the AT24 Anthropic org (Console → Settings → Privacy). Everything else (key, model, rate limit) is standard.

---

## 9. GO / NO‑GO

### CODE / DESIGN GO — ✅

- The K3 gate is fully specifiable against the current API (§1) and the current code (§2).
- Every change is **additive and local**: `lib/ai/{types,env,claude.provider}.ts` (optional fields + a guarded tools branch), a new `services/knowledge-loop/{classifier,orchestrator}/`, one edit to `knowledge/chat/route.ts`, config constants.
- **No** new dependency (REST stays, per SO‑1). **No** migration (`KnowledgeAnswerProvenance` already exists from K1). **No** change to K1/K2 retrieval/cache/freshness behaviour. **No** change to the market‑intel path, `AIPresenterOrchestratorService`, `assistant.service.ts`, Support Agent, Automation, Quant, Marketplace, Publishing, UI. **No** autonomous knowledge promotion (candidate creation deferred to K4).
- INV‑1 is unaffected: the orchestrator consumes `KnowledgeService.retrieve()` — the same eligibility‑filtered, cache‑safe path K2 hardened; it never reads `KnowledgeCandidate`.
- Contract↔code mismatches (§3) are all bridgeable additively; two need a one‑line ADR in `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` (M‑1 "reuses the *pattern*, not the literal service"; M‑8 "candidate creation → K4").

### LIVE‑PROVIDER GO — ⛔ NOT YET

Requires the owner to complete §5:

- **E‑2** — confirm web search is enabled on the AT24 Anthropic org.
- **E‑3** — provision `ANTHROPIC_API_KEY` into the Vercel project env (never committed).
- **E‑1 / E‑5** — Anthropic account with billing + adequate web‑search rate limit.

Until then, K3‑B can be **built and offline‑tested to completion** (all of §6.1), but K3 cannot be declared operationally complete and K3‑B's live smoke (§6.2) cannot run.

### Recommended sequencing for K3‑B

1. Owner completes §5 (E‑1, E‑2, E‑3, E‑5).
2. K3‑B‑1: additive `lib/ai` provider extension + `validate:knowledge-loop-claude-provider` (offline fixtures).
3. K3‑B‑2: classifier + web‑search gate + `KnowledgeAnswerOrchestrator` + offline validators.
4. K3‑B‑3: `knowledge/chat/route.ts` edit + `KnowledgeAnswerProvenance` writer + regression.
5. K3‑B‑4: live smoke (§6.2) + `K3_ACCEPTANCE.md`.
6. Only after §6.2 passes: **K3 operationally complete → K4 unlocked.**

---

## 10. Hard boundaries honoured by this document

No code changed. No migration. **No `ANTHROPIC_API_KEY` value appears anywhere in this file** (or in any commit, log, or artifact from K3‑A). No Support Agent / Automation / Quant / Marketplace / Publishing / UI reference. No change to K1/K2 retrieval/cache behaviour. No autonomous knowledge promotion designed. No new Tavily/Exa/vector‑DB/reranker/embedder proposed. No speculative rewrite of `ClaudeProvider` or `assistant.service.ts` — only the minimal additive extension in §4.

---

## 11. Change log

| Date | Entry |
|---|---|
| 2026‑09‑09 | K3‑A preflight. Fresh audit of the current Anthropic Messages API + native web search (§1 — K0 snapshot was stale: model IDs, `web_search_20250305`→`_20260209`, GA no‑beta, HTTP‑200 error shape, `pause_turn`, `encrypted_content`, $10/1k pricing). Read `main` @ `6ad50cb` (§2 — `ClaudeProvider` no‑tools, market‑intel chain ≠ general chat path, chat route flow, K1/K2 substrate). 8 contract↔code mismatches, all additively bridgeable (§3). Minimal file‑level plan (§4). Owner secret checklist (§5). Offline + live test plan (§6). **CODE/DESIGN GO ✅ · LIVE‑PROVIDER GO ⛔ (pending `ANTHROPIC_API_KEY` + org web‑search confirmation).** |
