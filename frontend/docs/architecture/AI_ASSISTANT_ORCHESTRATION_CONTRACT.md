# K0.4 — AI Assistant Orchestration Contract

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop
**Stage:** Contract lock — precedes K3
**Depends on:** [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md), [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md)
**Status:** PROPOSED — **Claude-primary + Claude native web search is a pending owner sign-off** (D-ORCH-2). See [`K0_DECISION.md`](K0_DECISION.md).

Defines how a chat turn flows through: intent classification → AT24 Knowledge
first → Claude reasoning → Claude Native Web Search fallback → answer →
provenance → optional candidate. The orchestrator is a **composition layer**;
it never computes facts and never mutates knowledge.

---

## 1. Entry point and boundary

```
POST /api/private/knowledge/chat   (existing route, extended)
  ├─ session auth (getUserOrNull)                       [unchanged]
  ├─ Conversation / Message persistence                 [unchanged]
  ├─ resolved-instrument market question?
  │     YES ──▶ IntelligencePresentationService.present()   [unchanged — D2.6.9 path wins]
  │     NO  ──▶ KnowledgeLoopOrchestrator.answer(turn)      [NEW — this contract]
  └─ NDJSON streaming envelope + non-streaming envelope [unchanged shapes]
```

**The market-intelligence path is not touched.** The orchestrator runs for
every non-market turn: product / platform / support / trading-education /
how-to / policy / conceptual questions. The gate is the existing
`IntelligencePresentationService` "resolved" check — if it returns
`resolved: true` the Knowledge Loop does not run for that turn.

The non-streaming response contract stays **byte-identical** for the
publishing / trading-copilot / agent callers (they call
`services/ai/assistant.service.ts` `sendMessage()` which never sets
`stream: true`). New fields (`intelligence`, provenance id) are optional and
additive, exactly as today.

---

## 2. Turn input

```
OrchestratorTurn = {
  requestId: string,
  userId: string,
  callerRole: string,
  conversationId: string,
  message: string,               // the current user message
  history: Message[],            // prior turns, chronological (already loaded by the route)
  symbol?: string,               // optional "active instrument" bias (D2.6.11) — passed through
  clientHints?: { saveThisAnswer?: boolean }   // an admin/support UI "promote" affordance
}
```

---

## 3. Step 1 — Classification

`services/knowledge-loop/classifier/` — a **disclosed heuristic**, not an LLM
call (same spirit as today's `detectSupportedMarketSymbol` / `needsLiveInfo`).
An LLM classifier is a post-beta upgrade behind the same interface.

```
classify(message, history) → {
  intent: "conceptual" | "product-static" | "how-to" | "policy"
        | "support-troubleshoot" | "current-info" | "account-specific" | "other",
  freshnessNeed: "STATIC" | "PERIODIC" | "DYNAMIC",   // what the ANSWER needs, not the knowledge class
  privacyClass: "public" | "user-specific" | "sensitive",
  explicitFreshnessRequest: boolean                   // "latest / today / now / current / news / this week"
}
```

Heuristics (initial, tunable):

| Signal | Sets |
|---|---|
| `\b(latest\|today\|now\|current\|currently\|recent\|news\|this week)\b` | `explicitFreshnessRequest = true`, `intent = current-info` |
| `\b(price\|quote\|rate)\b` + a symbol | routed to the market path *before* the orchestrator; if it still lands here → `freshnessNeed = DYNAMIC` |
| `\b(my account\|my subscription\|my order\|my licen[cs]e\|my invoice\|refund me)\b` | `privacyClass = user-specific`, `intent = account-specific` |
| API keys, emails, card numbers, names in the message | `privacyClass = sensitive` |
| `\b(how do i\|how to\|where is\|can i\|steps to)\b` | `intent = how-to` |
| `\b(what is\|explain\|difference between\|meaning of)\b` + no freshness word | `intent = conceptual`, `freshnessNeed = STATIC` |
| `\b(terms\|policy\|refund policy\|disclaimer\|privacy)\b` | `intent = policy` |
| `\b(error\|not working\|failed\|can'?t\|bug\|broken\|stuck)\b` | `intent = support-troubleshoot` |

Classification never blocks; on any ambiguity it errs toward
`freshnessNeed = PERIODIC` and `privacyClass = public` (retrieval + web-gate
handle the rest).

---

## 4. Step 2 — AT24 Knowledge retrieval (Priority 1)

```
retrieval = KnowledgeService.retrieve(message, {
  callerUserId: userId,
  callerRole,
  scopes: ["assistant", "shared"],     // Support Agent would pass ["support","shared"]
  includeUserScope: true,
  topK: RETRIEVE_TOP_K
})
```

Per [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md). The
orchestrator consumes `retrieval.sufficiency`, `retrieval.contextBlock`,
`retrieval.conflict`, `retrieval.hits`.

Emits: `KNOWLEDGE_QUERY` (always), then `KNOWLEDGE_HIT` /
`KNOWLEDGE_MISS` / `KNOWLEDGE_LOW_RELEVANCE` (from the retrieval layer).

---

## 5. Step 3 — Web-search gate (Priority 3 decision)

```
webSearchRequired =
     classification.explicitFreshnessRequest
  OR classification.freshnessNeed == "DYNAMIC"
  OR retrieval.sufficiency == "INSUFFICIENT"
  OR retrieval.sufficiency == "STALE"
  OR (retrieval.conflict AND conflictNeedsCurrentSource(classification))

webSearchForbidden =
     classification.privacyClass == "sensitive"                 // never send sensitive text to a web tool
  OR (classification.intent == "account-specific")              // web can't answer it; handled in §7
  OR (classification.intent in {"conceptual","policy"} AND retrieval.sufficiency == "SUFFICIENT")

useWebSearch = webSearchRequired AND NOT webSearchForbidden
```

When `useWebSearch` is true and no LLM provider supports web search
(availability check fails), the orchestrator proceeds **without** it and
records `webSearchRequestedButUnavailable: true` in provenance — it never
fabricates current information.

Emits `WEB_SEARCH_FALLBACK` when `useWebSearch` resolves true.

---

## 6. Step 4 — Context construction

```
buildClaudeContext({
  system: [
    AI_COMMUNICATION_POLICY,                       // lib/ai/response-policy.ts — unchanged, always
    KNOWLEDGE_LOOP_SYSTEM_INSTRUCTIONS             // see §6.1
  ].join("\n\n"),
  knowledgeBlock: retrieval.sufficiency != "INSUFFICIENT" ? retrieval.contextBlock : undefined,
  history: history.slice(-HISTORY_TURNS),          // HISTORY_TURNS = 8, matches context-manager.service.ts spirit
  userMessage: message,
  tools: useWebSearch ? [WEB_SEARCH_TOOL] : []
})
```

### 6.1 `KNOWLEDGE_LOOP_SYSTEM_INSTRUCTIONS` (LOCKED text intent)

> You are the AT24 platform assistant. Answer using the **AT24 Knowledge**
> block below when it contains the answer — it is verified, authoritative
> platform knowledge and takes precedence over your general knowledge and
> over web results for anything about AT24 products, platform behaviour,
> policies, and pricing.
> If the AT24 Knowledge block does not fully answer the question, say so
> briefly, then use web search results (if provided) and your general
> knowledge. Never present a web result as official AT24 policy.
> If AT24 Knowledge and a web result disagree about an AT24 fact, prefer AT24
> Knowledge and note the discrepancy.
> Follow the communication policy above at all times. Never invent AT24
> features, prices, or policies. If you don't know, say so.

### 6.2 Knowledge-vs-web conflict rule (LOCKED)

When both a knowledge hit and a web result address the same fact:

1. **Detect** — the orchestrator, post-answer, checks whether the answer
   text's claims align with knowledge or with web (reuse the
   `validateResponseIntegrity` claim-tracing pattern).
2. **Preserve both** provenance records (§8) — knowledge source *and* web
   source are both recorded, regardless of which the answer used.
3. **Prefer** per policy: for an **AT24 fact** (product/platform/policy/
   pricing) → AT24 Knowledge wins; for a **world fact** (a general market
   concept, an external event, a third-party tool) → the more current source
   wins.
4. **No silent mutation** — the orchestrator never writes to `Knowledge`.
5. **Candidate** — if the web result credibly contradicts an `active` AT24
   knowledge row about an AT24 fact, create a `KnowledgeCandidate`
   (`reasonForCandidate = admin-flagged`, evidence = both sources) so an
   admin decides whether the knowledge row is now wrong.
6. **Analytics** — emit `KNOWLEDGE_CONFLICT` with `{ knowledgeId, webDomain,
   chosen, basis }`.

---

## 7. Step 5 — Generation (Priority 2 / 3 / 4)

### 7.1 Provider chain (LOCKED, subject to D-ORCH-2)

```
providerChain = [ Claude, Gemini, OpenAI, DeterministicFallback ]
```

- **Claude is preferred** (was: Gemini). Reuses `AIPresenterOrchestratorService`'s
  exact slot mechanism (`isAvailable()` env check → `createPresenter()` →
  `present()` → integrity validate → fall through on any failure). The only
  change is slot order + Claude carrying the `web_search` tool.
- Each provider that supports server tools receives `tools` when
  `useWebSearch`. Today **only Claude's Messages API `web_search` server
  tool** is planned (Gemini's `googleSearch` grounding remains available as
  the *fallback* provider's own mechanism, unchanged).
- Every candidate answer is validated (`validateResponseIntegrity`-style:
  forbidden-phrase scan via `scanForForbiddenLanguage`, no fabricated AT24
  claims against the knowledge block) before it is returned. A failing
  candidate → next provider.
- If every real provider fails/unavailable/invalid → the
  `DeterministicFallback` restates only what the knowledge block contains (or,
  if none, a truthful "I couldn't retrieve a verified answer" message). It
  never fabricates.

### 7.2 `account-specific` intent

The orchestrator does **not** send account data to any LLM as free text.
For `intent = account-specific`, it either:
- routes to a structured account-data responder (out of K0 scope — a K-series
  follow-on / existing billing surfaces), or
- returns a deterministic "you can see this in <settings/billing page>"
  pointer sourced from `platform` knowledge.

No `account-specific` turn is ever cached or turned into a candidate.

### 7.3 `WEB_SEARCH_TOOL` definition (LOCKED shape)

```
WEB_SEARCH_TOOL = {
  provider: "claude-native",
  spec: { type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES (3) }
}
```

`ClaudeProvider` (K3 change) passes this in the `tools` array and parses
`server_tool_use` + `web_search_tool_result` content blocks, extracting per
result: `url`, `title`, `page_age` / fetched timestamp. No separate search
vendor, no `@anthropic-ai/sdk` dependency (REST, injectable fetch — the
existing `ClaudeProvider` convention).

---

## 8. Step 6 — Answer provenance (ALWAYS)

`model KnowledgeAnswerProvenance` — immutable, no update, no `deletedAt`
(mirror of `IntelligenceAuditTrace`):

| Field | Type | Notes |
|---|---|---|
| `id` | `String` cuid | |
| `userId` | `String` | denormalized, not FK |
| `conversationId` | `String?` | |
| `messageId` | `String?` | the assistant `Message` this describes |
| `requestId` | `String` | correlation |
| `sourceClass` | `String` | `AT24_KNOWLEDGE` \| `CLAUDE_REASONING` \| `CLAUDE_WEB_SEARCH` \| `MIXED` |
| `knowledgeContributions` | `Json` | `[{ knowledgeId, chunkId, similarity, usedInAnswer: boolean }]` |
| `webContributions` | `Json` | `[{ url, title, domain, retrievedAt, excerpt, usedInAnswer: boolean }]` |
| `providerUsed` | `String` | `"claude"` \| `"gemini"` \| `"openai"` \| `"deterministic-fallback"` |
| `providerAttempts` | `Json` | the fallback-chain attempt trace (safe metadata only — no raw error text, no keys; same rule as `AuditPresenterTrace`) |
| `webSearchUsed` | `Boolean` | |
| `webSearchRequestedButUnavailable` | `Boolean` | |
| `retrievalSufficiency` | `String` | from the retrieval layer |
| `conflict` | `Json?` | `{ knowledgeId, webDomain, chosen, basis }` when §6.2 fired |
| `integrityPassed` | `Boolean` | |
| `freshnessClass` | `String` | classifier's `freshnessNeed` |
| `privacyClass` | `String` | |
| `candidateCreatedId` | `String?` | |
| `answerCached` | `Boolean` | did this turn write the answer cache |
| `servedFromCache` | `Boolean` | did this turn read the answer cache |
| `latencyMs` | `Int` | total |
| `createdAt` | `DateTime` | |

Indexes: `[userId]`, `[conversationId]`, `[createdAt]`, `[sourceClass]`,
`[providerUsed]`.

**`sourceClass` derivation (deterministic):**

| Condition | `sourceClass` |
|---|---|
| answer used only knowledge-block content, no web | `AT24_KNOWLEDGE` |
| answer used web results, no knowledge block present/used | `CLAUDE_WEB_SEARCH` |
| answer used both knowledge and web | `MIXED` |
| no knowledge, no web — pure model reasoning | `CLAUDE_REASONING` |

For `MIXED`, `knowledgeContributions` and `webContributions` each mark
`usedInAnswer` so the per-source contribution is preserved.

The UI does not need to expose every field during beta; the backend retains
all of it for debugging, governance, and conflict analytics.

Emits `ANSWER_GENERATED` with `{ sourceClass, providerUsed, webSearchUsed,
latencyMs, integrityPassed }`.

---

## 9. Step 7 — Optional candidate

```
maybeProposeCandidate(turn, retrieval, answer, provenance):
  if provenance.privacyClass != "public": return          // never
  if provenance.integrityPassed == false: return          // never
  if classification.freshnessNeed == "DYNAMIC": return    // market/live values are not knowledge
  if classification.intent == "account-specific": return  // never

  eligible if ANY:
    · clientHints.saveThisAnswer == true  (admin/support "promote" click)
    · retrieval.sufficiency == "INSUFFICIENT"
        AND provenance.sourceClass in {"CLAUDE_WEB_SEARCH","CLAUDE_REASONING","MIXED"}
        AND classification.intent in {"how-to","product-static","support-troubleshoot","policy","conceptual"}
    · a correction to a prior assistant message was detected in this turn
        (user message pattern: "that's wrong", "actually", "no, it's ...") → reasonForCandidate = assistant-correction
    · retrieval produced a KNOWLEDGE_CONFLICT

  → CandidateService.propose({
        canonicalQuestion: normalize(message),
        proposedAnswer: answer.text,
        knowledgeType: mapIntentToType(classification.intent),
        sourceType: mapToSourceType(provenance.sourceClass, reasonForCandidate),
        evidence: { knowledgeSources: provenance.knowledgeContributions,
                    webSources: provenance.webContributions, origin: "candidate",
                    originatingConversationId, originatingMessageId, createdBy: userId,
                    createdAt: now },
        confidence: deriveConfidence(retrieval, provenance),
        reasonForCandidate
     })
```

`CandidateService.propose()` runs the dedup check
([`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) §8, thresholds
`DUP_HARD`/`DUP_SOFT`) and emits `KNOWLEDGE_CANDIDATE_CREATED`
(or attaches as a duplicate, no event). Never blocks the answer — wrapped
`.catch(() => {})` like every other best-effort write in the chat route.

---

## 10. Step 8 — Answer cache write

Per [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) §7.3.
Write only if all conditions hold; set `provenance.answerCached = true`.
Cache read happens at the **top** of `answer()` (before classification) —
a hit short-circuits to returning the stored answer + stored sources
(marked `servedFromCache`), still writing a lightweight provenance row and
`CACHE_HIT` / `ANSWER_GENERATED`.

---

## 11. Latency & cost budget (targets, enforced as alerts not hard caps in beta)

| Segment | Target p50 | Target p95 |
|---|---|---|
| classification | < 2 ms | < 5 ms |
| retrieval (cache miss: embed + pgvector) | < 400 ms | < 900 ms |
| retrieval (cache hit) | < 20 ms | < 50 ms |
| Claude generation (no web) | < 3 s | < 8 s |
| Claude generation (with web_search) | < 6 s | < 15 s |
| total (knowledge answer, no web) | < 3.5 s | < 9 s |
| total (web fallback) | < 7 s | < 16 s |
| answer-cache hit | < 150 ms | < 400 ms |

Cost controls: `WEB_SEARCH_MAX_USES = 3` per turn; `HISTORY_TURNS = 8`;
`CONTEXT_CHAR_BUDGET = 6000`; retrieval cache saves the embed call on repeats;
answer cache saves the whole chain for `STATIC` public questions. Per-turn
token estimate is logged in `providerAttempts` for a later cost dashboard.

---

## 12. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.4 created. Orchestrator sits behind the existing market-intelligence gate; runs for all other turns. Heuristic classifier (§3), web-search gate (§5), Claude-preferred provider chain reusing the existing fallback mechanism (§7), always-on `KnowledgeAnswerProvenance` with deterministic `sourceClass` (§8), guarded candidate proposal (§9). Claude-primary + native web search flagged D-ORCH-2 pending owner sign-off. |
