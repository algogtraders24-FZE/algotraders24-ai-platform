# CS1.2 — Chat Support Agent: Locked Decisions (ADR)

**Program:** AT24 Chat Support Agent (CS-series)
**Step:** CS1.2 — locked decisions (paired with CS1.1 audit)
**Base:** `origin/main` @ `4240006`
**Branch:** `feat/cs1-support-agent`
**Status of CS1 implementation slice:** built + validated (see §8); **not committed / not merged** pending owner sign-off.

---

These decisions are **locked** for the CS-series. A change to any of them is
a new decision record, not an edit here.

---

## D1 — Strict separation from the main AI Assistant

The Chat Support Agent shares **no runtime path** with the main AI Assistant.
It does not import or call `services/ai/*`, `/api/private/knowledge/chat`, the
`Conversation` / `ConversationMessage` stack, or the intelligence pipeline.
It runs **only** on the agent-framework runtime, through its own agent type,
its own two tools, its own API agent-type entry, its own route
(`/dashboard/support`) and its own nav entry (under **ACCOUNT**, not under
**INTELLIGENCE → AI Agents**).

*Enforced by:* `validate:agent-support` structural test (no support file
references `services/ai` / `knowledge/chat` / `assistant.service`); the file
set is disjoint from the Assistant's.

## D2 — Shared Knowledge foundation, `scope = "support"`, **no migration**

The support corpus is a set of governed **`Knowledge` rows at
`scope = "support"`**, `lifecycleStatus = "active"`, `knowledgeType ∈ {faq,
support, policy, product}`. It is **not** a system-user-owned island and
**not** a `scope = user` workaround.

Retrieval is the existing eligibility-filtered contract, called at the
**repository** layer (never `KnowledgeService` — INV-1):

```ts
RepositoryFactory.vectors().searchSimilar({
  embedding,
  topK,
  scopes: ["support"],
  visibilities: ["public", "customer"],   // authenticated-user view
  includeUserScope: false,                // never the caller's own KB
})
```

**Consequences:** zero schema migration; no dedicated system user; the
support corpus is naturally invisible to the main Assistant (which retrieves
`assistant` / `shared`, never `support`); K4 Governance will see and manage
Support Knowledge like any other governed scope; `scripts/seed-support-kb.ts`
creates `scope = support` rows through the existing K create →
`publishKnowledge` (markActive + ingest + embed) flow.

### D2a — Evidence typing reuses in-enum values

`AgentEvidenceType` is a Postgres enum without `support_document` /
`account_record`. CS1 **reuses** in-enum values rather than migrate:

| Evidence | `type` | `source` | `provenance.producer` |
|---|---|---|---|
| support-KB chunk | `research_document` | `support-kb:<knowledgeType>` | `support-kb-vector-search` |
| account status fact | `derived` | `account:<domain>` | `account-records-read` |

The `source` prefix and `producer` are the semantic discriminator — the
specialist branches on `source`, never on `type`. `AgentEvidence` stays
truthful and auditable. Precise `support_document` / `account_record` enum
values are **deferred to CS2** if trace/analytics requirements justify a
migration.

## D3 — Support-knowledge domains

FAQ / products / billing / credits / purchases / licenses / troubleshooting /
policies / verified resolutions. Each is a `knowledgeType` + `category` on the
`scope = support` corpus (mapping table in CS1.1 §3). "Verified resolutions"
are `knowledgeType = support`, `category = verified-resolutions`, and — when
authored through K4 — `sourceType = support_resolution`.

## D4 — Authority & tool boundary (read-only + escalate-to-human)

- **Agent type:** `SUPPORT`, `autonomyCap: 1`.
- **Permissions seeded:** `CAN_RUN_SUPPORT`, `CAN_READ_ACCOUNT_RECORDS` —
  both new (`PermissionKey` append), autonomy-floor 0, **not** dangerous.
- **Tools (exactly two, both read-only):**
  - `support.knowledge_search` — corpus retrieval (D2). `category: SUPPORT`,
    requires `CAN_RUN_SUPPORT`.
  - `support.account_read` — the **requester's own** plan / subscription /
    purchase / license **status**, by `ctx.userId` only (no input selects a
    user). `category: ACCOUNT`, requires `CAN_READ_ACCOUNT_RECORDS`.
    **Never returns** `apiKeyHash`, `signature`, provider refs
    (`stripeSubscriptionId` / `nowPaymentsInvoiceId` / `providerRef`), or a
    monetary amount — a boolean `hasPaymentProvider` is the most it says
    about payment linkage.
- **Never granted / never built:** any write, `CAN_GENERATE_SIGNAL`, any
  order/trade permission, any memory write (v1).
- `support.account_read` is planned **only** when the question is
  account-scoped (a billing/subscription/purchase/license marker matches) —
  never speculatively.

## D5 — Escalation boundary

When `coverage = "no-coverage"` (the corpus did not answer), **or** the
question is a request for an account change this read-only agent can never
make (cancel / refund / upgrade / downgrade / reset password / delete
account / move activation / …), the output sets:

```json
{ "escalate": true, "escalationReason": "<fixed safe string>" }
```

`escalationReason` is one of a small closed set of hyphenated strings that
never contain forbidden trading language. **No support ticket is created**
in CS1 — the hand-off is structured data the UI surfaces; a ticket/routing
flow is CS2.

## D6 — Output contract (`support-answer`) — no prose, no passage text

The run output is **citation refs + account-status finding refs + the
escalation decision**, never a generated prose answer and never the KB
passage text:

```
{ kind: "support-answer", resolved, coverage, citationCount, topics[],
  citations: [{ evidenceId, topic, source, relevance, confidence }],
  accountFindings: [{ evidenceId, domain }],
  escalate, escalationReason, evidenceCount, evidenceIds[], disclaimer }
```

The raw user question is **never** echoed into a scanned string field
(a support question can itself contain "buy"/"sell"). The passage text lives
in the `AgentEvidence.claim` (not signal-scanned by A6) and is rendered by
the presenter/UI. This is what lets a legitimate support answer whose source
says *"click Buy Now"* pass the A6 `autonomyLevel < 2` signal-language gate —
proven by `validate:agent-support`.

## D7 — Synthesis is deterministic, no LLM

`supportSpecialist.planTools` / `.synthesize` are pure and deterministic
(A5/G04 lock). No LLM in the plan or the synthesis. The plan is
`support.knowledge_search` → (`support.account_read` iff account-scoped).

## D8 — Surface

CS1 ships an **authenticated** console at `app/dashboard/support/page.tsx`,
backed by the existing framework runs API with `agentType: "SUPPORT"`. Nav
entry under **ACCOUNT** (`config/dashboard.config.ts`). A pre-auth / public
widget is **deferred** (CS1.1 §6) — it needs an anonymous-safe path binding
**only** `support.knowledge_search`, never `support.account_read`.

## D9 — Deferred to CS2+

Pre-auth widget · support ticket model + human routing · K4-governed corpus
authoring · precise evidence enum values · multi-turn conversation continuity
· the legacy `customer-support` alias stays **unmapped** (the `SUPPORT` type
is new, not the legacy mock).

---

## 8. CS1 implementation slice — what was built

| File | Role |
|---|---|
| `types/agent-framework/permission-contract.ts` | + `CAN_RUN_SUPPORT`, `CAN_READ_ACCOUNT_RECORDS` (append). |
| `types/agent-framework/tool-contract.ts` | + `ToolCategory` `SUPPORT`, `ACCOUNT` (append). |
| `services/agent-framework/agent-type-registry.ts` | + `SUPPORT` to the `AgentType` union + a frozen registry spec. |
| `services/agent-framework/tools/impl/support-knowledge-search.tool.ts` | **NEW** — `searchSimilar({ scopes: ["support"] })` adapter. |
| `services/agent-framework/tools/impl/support-account-read.tool.ts` | **NEW** — read-only status of the session user's own records. |
| `services/agent-framework/tools/{registry-manifest,tool-credit-costs}.ts` | register both tools (`REGISTERED_TOOL_IDS` → 8); placeholder costs. |
| `services/agent-framework/supervisor/specialists/support.specialist.ts` | **NEW** — `key: "SUPPORT"`, deterministic plan + evidence-first synthesis. |
| `services/agent-framework/supervisor/specialist-registry.ts` | `SUPPORT → supportSpecialist`. |
| `services/agent-framework/agents/support-agent.ts` | **NEW** — `supportAgentDefinition()` + `runSupportAgent()` (A11 shape). |
| `services/agent-framework/api/agent-run-service.ts` | + `SUPPORT` to `RUNNABLE_AGENT_TYPES` / `DEFINITION_FACTORIES` / `GOAL_HINTS`. |
| `app/dashboard/support/page.tsx` | **NEW** — the Support Assistant console. |
| `config/dashboard.config.ts` | + **Support** nav item under ACCOUNT. |
| `scripts/validate-agent-support.ts` + `package.json` | **NEW** `validate:agent-support` (12 tests). |
| `scripts/seed-support-kb.ts` + `package.json` | **NEW** `seed:support-kb` — 8 starter `scope=support` rows. |
| `scripts/validate-agent-{contracts,api}.ts` | assertion bumps (11 permission keys, 12 tool categories, 9 agent types, 4 runnable types). |

**Not touched:** the A4–A10 core, the A6 gate, `services/ai/*`,
`/api/private/knowledge/chat`, `services/knowledge-loop/*`, the legacy
`services/agents/*` scaffold, `/dashboard/agents`. **No schema change. No
migration. No LLM from any route or the specialist.**

### Verification (offline + against the shared dev DB)

- `validate:agent-support` **12/0** — definition valid; `SUPPORT →
  supportSpecialist`; deterministic plan (kb-only vs kb+account); structural
  (no static `lib/ai`, no executor, no `services/knowledge-loop`,
  server-only); FAKE-registry E2E → `support-answer` → **A6 integrity PASS**
  → A10 evaluation; **A6 signal-language proof** (a cited passage containing
  "buy"/"sell" still passes because the output holds no passage text);
  D2a evidence-typing proof; honest emptiness → `escalate`; mutation intent
  → `escalate` with the account-change reason; account findings status-only,
  no secrets; REAL-registry best-effort → clean terminal state.
- Regression: `validate:agent-contracts` 38/0, `validate:agent-tools` 20/0,
  `validate:agent-api` 9/0, `validate:agent-supervisor` 11/0,
  `validate:agent-research` 9/0, `validate:agent-integrity` 21/0,
  `validate:agent-runtime` 9/0, `validate:agent-authorization` 17/0
  *(remaining suites run before sign-off).*

### Open sign-off items

1. Approve D1–D9 as locked.
2. Approve the reused-enum evidence-typing decision (D2a) vs a CS2 migration.
3. Approve seeding the 8 starter `scope=support` rows into the shared dev DB
   (`npm run seed:support-kb`) for live browser verification; and whether the
   same set is acceptable as the initial production support corpus or should
   be replaced with product-authored content first.
4. Approve the **ACCOUNT** nav placement (note: a merge point with the
   in-flight `feat/ui-01` nav refactor — one added array item).
