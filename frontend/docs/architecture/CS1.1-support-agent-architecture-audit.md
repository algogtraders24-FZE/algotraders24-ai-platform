# CS1.1 — Chat Support Agent: Architecture Audit

**Program:** AT24 Chat Support Agent (CS-series)
**Step:** CS1.1 — architecture audit + gap analysis (read-only; paired with CS1.2 locked decisions)
**Base:** `origin/main` @ `4240006` (AN A1–A15 framework merged + live-verified; K0–K2 Knowledge Loop merged + prod-migrated)
**Branch:** `feat/cs1-support-agent`
**Migration:** **none** (see §5)

---

> **The Chat Support Agent is a customer-support specialisation of the
> existing AT24 Agent Framework runtime, reading a governed platform
> knowledge corpus that already exists.** It is *not* a new AI system, not a
> second RAG stack, and shares nothing with the main AI Assistant.

---

## 1. What already exists that CS1 must reuse

### 1.1 The Agent Framework runtime (AN A1–A15, production-live)

`services/agent-framework/` is a real, vendor-independent agent operating
layer: declarative contracts (`types/agent-framework/`), a resumable
`tick()` runtime (A4), a deterministic Supervisor + per-type Specialists
(A5), an LLM-independent output-integrity gate (A6), a policy-gated memory
authority (A7), a central authorization decision boundary (A8), an
idempotent credit ledger (A9), a heuristic evaluator (A10), and a thin
ownership-scoped API/UI seam (A15). Three agents ride it today —
`RESEARCH`, `MARKET_INTELLIGENCE`, `STRATEGY_RESEARCH` — each added the
**A11 way**: *agent definition + bounded plan + tool bindings + deterministic
synthesis, no new infrastructure* (owner locks G10–G13).

The A15 seam (`services/agent-framework/api/agent-run-service.ts` +
`app/api/private/agents/framework/runs/*`) already: derives `userId` from the
server session (never the body), ownership-scopes every run read, and drives
execution as bounded `start → tick → checkpoint → poll` slices. A new
runnable agent type is **one entry** in `RUNNABLE_AGENT_TYPES` +
`DEFINITION_FACTORIES` + `GOAL_HINTS`; the routes pick it up unchanged.

### 1.2 The Knowledge Loop foundation (K0–K2, merged, prod-migrated 2026‑09‑09)

`services/knowledge-loop/knowledge/` + the K1 schema additions to `Knowledge`
give AT24 a **governed platform knowledge base**:

- `enum KnowledgeScope { user, assistant, support, shared }` — **`support`
  already exists** and is what a support corpus is meant to use
  (`KNOWLEDGE_CONTRACT.md` §8: *"`support` | troubleshooting, known issues,
  resolution steps | `scope = support` … sourced from support resolutions"*).
- `enum KnowledgeType { product, platform, trading_education, policy,
  support, faq }` and `enum KnowledgeSourceType { …, support_resolution, … }`
  — the exact CS1 domain vocabulary.
- Lifecycle columns (`lifecycleStatus`, `supersededById`, `expiresAt`,
  `freshnessClass`, …) and a version fingerprint.
- **Eligibility-filtered retrieval** in
  `repositories/VectorRepository.ts::searchSimilar({ scopes, visibilities,
  includeUserScope, callerUserId })` — a single SQL gate that enforces
  `lifecycleStatus = 'active' AND supersededById IS NULL AND (expiresAt IS
  NULL OR future) AND scope = ANY(scopes) AND visibility = ANY(visibilities)`.
  With `scopes` omitted the query is byte-identical to the pre-K1 behaviour.
- A K2 Postgres retrieval cache + freshness sweep.

`KnowledgeService` (the application boundary) is **explicitly off-limits to
`services/agent-framework/*`** — INV-1, grep-guarded by
`scripts/validate-knowledge-loop-schema.ts` (*"no `services/agent-framework/**`
file imports `services/knowledge-loop`"*). The lower-level
`repositories/VectorRepository.ts` seam is shared and allowed — this is
exactly how `research.knowledge_search` already retrieves.

### 1.3 Billing / entitlement / license data

`User.planId/status`, `Subscription`, `Purchase → Entitlement → License`
(M11 chain), all `userId`/`buyerId`-scoped. `services/licensing/myPurchases.ts`
is a real, status-only read of a buyer's own purchases + license state. No
support-ticket model exists.

### 1.4 The main AI Assistant (must stay uninvolved)

`services/ai/assistant.service.ts` → `/api/private/knowledge/chat` is a
RAG chat over the *user's own* `scope = user` knowledge plus the
deterministic intelligence pipeline. It has no support corpus and no support
role. K3-B (the orchestrator that will retrieve `["assistant","shared"]`) is
**not on `main`** yet; the route today does plain user-scoped RAG.

---

## 2. Gaps CS1 closes

| Gap | Resolution in CS1 |
|---|---|
| No customer-facing support agent | New `SUPPORT` agent type + specialist + definition (A11 pattern). |
| No support corpus | `scope = "support"` `Knowledge` rows, seeded by `scripts/seed-support-kb.ts` through the existing K-series create → `publishKnowledge` (markActive + ingest + embed) flow. Zero migration — the enum value exists. |
| No support tools | `support.knowledge_search` (corpus retrieval via `searchSimilar({ scopes: ['support'] })`) and `support.account_read` (the requester's own plan/subscription/purchase/license **status**). |
| No support surface | `app/dashboard/support/page.tsx` — a focused console, its own nav entry, deliberately separate from the trading "AI Agents" run console. |
| Support answers naturally contain "buy"/"sell" | The A6 gate rejects that language in a constrained agent's *output*. CS1 follows the A11 citation discipline: the output carries only citation **refs**; the passage text stays in the immutable `AgentEvidence` row (which A6 does not signal-scan) and is rendered by the presenter. Proven by `validate:agent-support`. |

---

## 3. Support-knowledge domains → sources

| Domain | Source |
|---|---|
| FAQ | `scope=support`, `knowledgeType=faq` |
| Products | `knowledgeType=product` (how-to, supported platforms) |
| Billing / credits / purchases | `knowledgeType=faq`/`policy` for *how-to*; `support.account_read` for the requester's *live status* |
| Licenses | `knowledgeType=support` for *how activations work*; `support.account_read` for *this account's* license state |
| Troubleshooting | `knowledgeType=support` |
| Policies | `knowledgeType=policy` (refunds, what the assistant can/can't do) |
| Verified resolutions | `knowledgeType=support`, `category=verified-resolutions` (curated, source-typed `support_resolution` when authored through K4) |

`support.account_read` returns **status fields only** — never `apiKeyHash`,
`signature`, `stripeSubscriptionId`, `nowPaymentsInvoiceId`, `providerRef`,
or monetary amounts.

---

## 4. Authority & tool boundary (locked in CS1.2 D4)

- `SUPPORT` type, `autonomyCap: 1`, seeded permissions `CAN_RUN_SUPPORT` +
  `CAN_READ_ACCOUNT_RECORDS` (both new, append-only, autonomy-floor 0, never
  dangerous).
- Two tools, **both read-only**. No write path anywhere. Never seeds
  `CAN_GENERATE_SIGNAL` or any order/trade permission (A8 rejects them
  anyway; the agent never asks).
- No memory writes in v1.
- Unresolved question, or a question that needs an account change → the
  output sets `escalate: true` with a fixed, safe reason string. **No ticket
  is created** — a hand-off flow is CS2.

---

## 5. Why no migration

- `KnowledgeScope.support`, `KnowledgeType.{faq,support,policy,product}`,
  `KnowledgeSourceType.support_resolution` — **all already in the schema**,
  migrated to prod by K1 (2026‑09‑09).
- `AgentEvidenceType` **is** a Postgres enum and does **not** contain
  `support_document` / `account_record`. CS1.2 D2 therefore **reuses**
  in-enum values — support-KB evidence is `research_document`, account-status
  evidence is `derived` — and carries the real distinction on
  `evidence.source` (`support-kb:*` / `account:*`) and
  `provenance.producer` (`support-kb-vector-search` / `account-records-read`).
  Precise enum values are a deferred CS2 schema enhancement.
- New `ToolCategory` values (`SUPPORT`, `ACCOUNT`) and `PermissionKey` values
  are pure TS contract additions — tools and permissions are not persisted as
  enum columns.

---

## 6. Deferred (out of CS1 scope)

- Pre-auth / public support widget (pricing page, checkout, locked-out
  sign-in). Needs an anonymous-safe path with **no** account-data tool.
- Support ticket model + human-agent routing (CS2).
- K4 Governance authoring of the support corpus (CS1 seeds a bootstrap set;
  production authoring should go through K4 approval once it exists).
- Precise `support_document` / `account_record` evidence enum values.
- Conversation continuity across support turns.

---

## 7. Related

`AN1.13` (Research Agent — the pattern CS1 follows), `KNOWLEDGE_CONTRACT.md`,
`KNOWLEDGE_RETRIEVAL_CONTRACT.md`, `K1_DECISION.md` (INV-1),
`AN1.17` (the A15 API/UI seam CS1 extends).
