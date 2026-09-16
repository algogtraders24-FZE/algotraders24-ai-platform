# AT24 Support Chat — Master Architecture & Implementation Reconciliation

**Program:** Autonomous Support System
**Stage:** Discovery / architecture reconciliation. **NO implementation, NO
schema migration, NO new Support generation code, NO UI redesign, NO provider
integration in this sprint.**
**Base:** `origin/main` @ `31c5bd0`
**Branch / worktree:** `docs/support-chat-master-architecture`, `E:/support-chat-arch`
**Depends on / consolidates:** CS1, P1 (`AUTONOMOUS_SUPPORT_P1_CONTRACT.md`),
Track 1 (PR #71, KB content expansion), Track 2
(`SUPPORT_GENERATIVE_ANSWER_RND.md`, GA-D1–D10)

## 0. Repo safety report

| Check | Result |
|---|---|
| Base SHA | `31c5bd0` (`origin/main`, confirmed via `git fetch` + `git log -1`) |
| Branch | `docs/support-chat-master-architecture`, new, off fresh `origin/main` |
| Worktree state | `E:/support-chat-arch`, freshly created, 0 uncommitted changes |
| Track 2 merge SHA | `90e2d7e`, confirmed `git merge-base --is-ancestor 90e2d7e origin/main` |
| Primary worktree | `E:/algotraders24-ai-platform`, still on stale `feat/ui-01-premium-ui-foundation` (`ae3d789`), 83 pre-existing uncommitted lines, **not touched** |
| Existing Support-related commit chain (newest→oldest, all on `main`) | `31c5bd0`/`90e2d7e` (Track 2 R&D) ← `6093ad3`/`6f7053d` (Track 1, PR #71) ← `9968441`/`c6cd7ce` (P1 contract) ← `93875a2`/`bfc2cb1`/`fadef60` (P1 impl+remediation) ← `9ad2c7a`/`22491da` (Autonomous Support R&D) ← `63d4eb1`/`fa0bc1c` (CS1) |

---

## 1. Current-state reconciliation (inspected directly, not assumed)

### 1.1 CS1 / core specialist

- `services/agent-framework/supervisor/specialists/support.specialist.ts`:
  `ACCOUNT_MARKERS` (line 36, private), `MUTATION_MARKERS` (line 43, **exported**
  — reused by the P1 guest path), `SUPPORT_STRONG_MATCH = 0.6` (line 56,
  exported), `SUPPORT_CITE_BAND = 0.1` (line 57, exported). Deterministic plan:
  always `support.knowledge_search`; `support.account_read` added only if
  `ACCOUNT_MARKERS` matches. `coverage` = `kb-answered | account-context |
  no-coverage`; `resolved = coverage !== "no-coverage"`; `escalate = !resolved
  || mutationIntent`. **No LLM anywhere in this file.**
- `services/agent-framework/tools/impl/support-knowledge-search.core.ts`:
  shared retrieval core (extracted in P1). `SUPPORT_MIN_SIMILARITY = 0.45`
  (tool-level noise floor), `MAX_SUPPORT_TOP_K = 8`. `searchSupportKnowledge(query,
  {visibilities, topK})` → embed → `RepositoryFactory.vectors().searchSimilar()`
  → filter by min-similarity → join `Knowledge` for topic/title.
- `support-knowledge-search.tool.ts` (authenticated): `visibilities:
  ["public","customer"]`. `support-account-read.tool.ts`: reads
  `prisma.user/subscription/purchase` **by `ctx.userId` only** — no
  user-selecting input field exists; structurally cannot cross accounts.
  Returns plan/subscription/purchases/licenses **status only** — never
  `apiKeyHash`/`signature`/provider refs/amounts.
- **FORBIDDEN_TEXT** (`scripts/validate-agent-support.ts:179`):
  `[/\bbuy\b/i, /\bsell\b/i, /\bguaranteed\b/i, /win[- ]?rate/i]` — a *test*
  assertion, not runtime-enforced code; the actual runtime safety comes from
  D6's structural discipline (citations only, never restated prose), which is
  why a passage containing "Buy Now" still passes the A6 signal-language gate
  today — there is nothing for a forbidden-word scanner to catch because no
  prose is ever generated.
- **Support permissions** (`types/agent-framework/permission-contract.ts:34-35,47-48`):
  `CAN_RUN_SUPPORT`, `CAN_READ_ACCOUNT_RECORDS` — both non-dangerous, floor 0.
- **Support credit handling** (`services/agent-framework/tools/tool-credit-costs.ts:19-20`):
  flat `support.knowledge_search: 2`, `support.account_read: 1` credits per
  call, charged via the same `creditLedger.charge()` (`agent-runtime.ts:448,519`)
  every other tool call in the framework uses. No Support-specific ledger.
- **AgentRun/AgentEvidence integration:** unchanged A1–A15 runtime. Evidence
  reuses in-enum `AgentEvidenceType` values (`research_document` for KB hits,
  `derived` for account status) — CS1.2 D2a, zero new enum value, discriminated
  by `source`/`provenance.producer`.
- **Existing escalation:** `escalate: true` + a fixed reason string in the run
  output. **No ticket, no queue, no human-visible context package** — this is
  a signal only, unchanged since CS1 (CS1.2 D9 explicitly deferred the real
  hand-off artifact to "CS2," never built).
- **Existing Support UI:** `app/dashboard/support/page.tsx` — full-page,
  authenticated-only console, now using the shared `useSupportRun` hook
  (extracted in P1). Unchanged since CS1 except that extraction.

### 1.2 P1 (contract `4d9d21a`/`c6cd7ce` + implementation `fadef60`/`bfc2cb1`)

- **Authority ceiling:** L1 (guest, KB-only, `visibility:public`) / L1–L2
  (authenticated, identical to CS1). **No L3+, unchanged by this document.**
- **Evidence requirements:** unchanged from CS1 — citation-only, never
  restated prose, for both guest and authenticated paths.
- **Resolution confirmation:** `recordResolutionConfirmation(userId, runId,
  confirmed)` (`agent-run-service.ts:200`) — writes
  `metadata.resolutionConfirmation: {confirmed, confirmedAt}` into the
  existing `AgentRun.metadata` Json column (additive, no migration). A
  positive confirmation requires: terminal status
  (`RunNotTerminalError` else), `metadata.definition.type === "SUPPORT"`
  (`ResolutionNotEligibleError` else — the merge-review fix that scopes this
  to Support runs only), and `coverage !== "no-coverage" && !escalate`
  (`ResolutionNotEligibleError` else). **A negative confirmation is never
  gated** — it can't produce a false-positive metric.
- **Guest boundary:** `services/support/guest-knowledge-query.ts` — never
  imports the account tool, never reads a session, never enters
  `AgentRun`/A1–A15 at all. `GUEST_VISIBILITIES = ["public"]` hard-coded.
  `MUTATION_MARKERS` reused (imported from the specialist) for the same
  honest escalation on a guest mutation-intent question.
  `services/support/guest-rate-limit.ts`: in-process, per-IP (last
  `X-Forwarded-For` hop, post-merge-review fix), 10 requests/60s window,
  disclosed as not-distributed (per-instance budget under real Vercel
  concurrency).
- **Escalation rules:** identical signal (`escalate:true` + reason) for both
  guest and authenticated; the widget renders a static "Talk to a human" →
  `/company/contact` link + (as of Track 1) `support@algotraders24.ai`. No
  hand-off artifact, same as CS1.
- **UI:** `components/support/SupportWidget.tsx` — root-mounted (every page),
  two modes (`guest`/`authenticated`) selected by a **non-authoritative**
  session probe (`GET /api/support/session`). Guest transcript persists in
  `sessionStorage` and renders unconditionally (merge-review fix 1 — survives
  a login transition). Authenticated mode uses the shared `useSupportRun`
  hook.

### 1.3 Track 1 (PR #71, `6f7053d`/`6093ad3`)

- **Current Support KB corpus:** 16 `scope=support` rows (verified:
  `grep -c title: scripts/seed-support-kb.ts` minus the interface declaration
  line = 16 real entries), **10 `visibility:public`, 6 `visibility:customer`**.
  8 original CS1 bootstrap rows (billing/credits/refunds/licenses/products/
  troubleshooting/verified-resolution/policy) + 8 added in Track 1 (6 sourced
  verbatim from the live public FAQ, 2 new: general troubleshooting + how to
  reach human support).
- **Retrieval behavior:** unchanged mechanism, now over 16 rows instead of 8.
- **Strong-match threshold:** unchanged, `SUPPORT_STRONG_MATCH = 0.6`.
- **Weak/sub-threshold hits:** `searchSupportKnowledge` already computes
  similarity for every retrieved row (`SUPPORT_MIN_SIMILARITY = 0.45` floor)
  — rows scoring between 0.45 and 0.6 are **already retrieved and then
  silently discarded** by the specialist today (`coverage` only becomes
  `kb-answered` above 0.6). This discarded-but-computed data is exactly
  Track 2's proposed generation input (§7, GA-D9 area) — no new retrieval
  code needed to obtain it.
- **Visibility filtering / guest retrieval:** unchanged from P1 —
  `["public"]` for guests, `["public","customer"]` for authenticated.
- **Live-verified, documented limitation (not fixed by this sprint):** exact
  casual phrasing ("how its work", "support not wroking properly") and even
  a clean paraphrase ("the site is not working properly") still score below
  0.6 and escalate. This is the confirmed motivation for Track 2 — carried
  forward, not re-litigated here.

### 1.4 Track 2 (`SUPPORT_GENERATIVE_ANSWER_RND.md`, `90e2d7e`/`31c5bd0`)

**GA-D1–D5 carried forward exactly, unchanged, not re-opened:**
- GA-D1: generation is a fallback ONLY for `no-coverage` + no mutation
  intent — never replaces a strong citation.
- GA-D2: generation NEVER receives account data as input, structurally.
- GA-D3: reuse the K3 orchestrator *pattern*, never import
  `services/knowledge-loop/**` from `services/agent-framework/**`.
- GA-D4: a new `coverage: "kb-generated"` value, distinct from
  `kb-answered`, so no metric can conflate generated-unverified with
  cited-evidence.
- GA-D5: a failed generation falls through to the existing escalation path,
  unchanged — can only improve `no-coverage`, never regress it.

**GA-D6–D10 are resolved with evidence in §7 of this document — not
silently decided, not left unresolved either, per the brief's explicit
instruction to resolve them with repository evidence this sprint.**

### 1.5 K3/K3-C — architectural precedent only, not imported

`services/knowledge-loop/orchestrator/knowledge-answer-orchestrator.ts`
(425 lines, re-inspected fresh in this worktree) confirms the reusable
*pattern*, verbatim from the merged R&D doc: `RetrievalPort` → one prompt →
`AnswerProviderSlot[]` chain (`claude → gemini → openai`, strict
first-clean-wins) → `scanForForbiddenLanguage` (`lib/ai/compliance.ts` — a
plain `lib/` utility, **not** under `services/knowledge-loop/`, safe to
import from Support without an INV-1 violation) → deterministic fallback →
provenance write for every outcome. `decidePreGeneration`'s account-specific
short-circuit fires *before* any generation call exists — independently
arrived at, same principle CS1.2 already locked for a different domain. This
document does not import any file under `services/knowledge-loop/**`
anywhere in its proposal — confirmed by design, not by omission.

---

## 2. Target architecture

```
USER
  ↓
SUPPORT CHAT  (one experience — guest widget / authenticated widget /
                /dashboard/support full page all present the SAME model)
  ↓
Deterministic authority/intent gate (EXISTING, unchanged — ACCOUNT_MARKERS /
MUTATION_MARKERS in support.specialist.ts)
  │
  ├── Account question (ACCOUNT_MARKERS matches, no mutation intent)
  │      ↓
  │   EXISTING support.account_read path (L2, unchanged, evidence-only)
  │
  ├── Mutation/request (MUTATION_MARKERS matches)
  │      ↓
  │   EXISTING escalate:true path (unchanged)
  │
  └── Informational/troubleshooting (neither marker matches)
         ↓
      EXISTING support.knowledge_search retrieval (unchanged, scope=support)
         │
      ┌──┴──────────────────┐
      │                      │
  Strong match (≥0.6)    Weak/no match (<0.6, incl. sub-0.45 noise)
      │                      │
      ▼                      ▼
  EXISTING kb-answered   NEW (Track 2, not built in this sprint):
  citation path,         generative fallback using the ALREADY-RETRIEVED
  unchanged              sub-threshold hits as grounding
                              │
                              ▼
                        scanForForbiddenLanguage (reused from lib/ai/compliance.ts)
                              │
                       ┌──────┴──────┐
                       │             │
                    Clean          Fail (no clean candidate, or
                       │            provider chain exhausted)
                       ▼             ▼
              coverage:          EXISTING escalate:true /
              "kb-generated"     "Talk to a human" path
              (new, distinct     (completely unchanged —
              value, never       this proposal can only
              counted as a       improve the no-coverage
              real citation)     case, never regress it)
```

**What is genuinely new here (not yet built, scoped only):** the single
box "generative fallback" and its two children. **Everything else in this
diagram already exists, is already merged, and is unchanged by this
document.**

---

## 3. Gap matrix

| Capability | Existing | Missing | Existing component to reuse | New implementation required |
|---|---|---|---|---|
| KB retrieval | ✅ Yes — 16 rows, threshold-gated | — | `support-knowledge-search.core.ts` | None |
| Natural-language generation | ❌ No | ✅ Yes — the entire Track 2 gap | K3's provider-slot pattern, `lib/ai/compliance.ts` | A new Support-scoped generation module (not built here) |
| Multi-turn context | ❌ No (confirmed §8 — each `ask()` starts a brand-new `AgentRun` with only `{question}`, no history param anywhere) | ✅ Yes | None — this is a genuine gap, not a reusable pattern | New (§8, §9 Phase B) |
| Account-aware assistance | ✅ Yes — L2, `support.account_read`, status-only | — | Unchanged | None |
| Troubleshooting | ⚠️ Partial — 2 KB rows only ("password reset", "analysis stuck"), no active diagnostic flow | ✅ Richer troubleshooting | Existing KB rows + (future) generation for informational triage | New investigation tooling is explicitly OUT of this sprint's scope (would be L2-richer, a separate future phase, not proposed here) |
| Compliance | ✅ Yes — `scanForForbiddenLanguage` exists platform-wide, structural citation-only discipline for the existing path | ⚠️ Not yet wired to a generation path (none exists) | `lib/ai/compliance.ts` | Wire it into the new generation module when built |
| Provenance | ✅ Yes for existing paths — `AgentEvidence` | ⚠️ For a *generated* answer specifically | `AgentEvidence` (toolCallId nullable — reusable, see §7 GA-D6) + `AgentStepKind.model_call`/`.evidence` (both already in the enum, unused) | A new evidence-writing call site, zero schema change |
| Credits/cost | ✅ Yes — A9 `creditLedger.charge()`, flat per-tool cost model | ⚠️ No cost model for generation | `tool-credit-costs.ts` pattern, `CreditLedger.charge()` | A new flat/tiered cost entry (see §7 GA-D7) |
| Rate limiting | ✅ Yes — guest per-IP (`guest-rate-limit.ts`); authenticated implicitly via monthly credit allowance | ⚠️ No generation-specific limit | Both existing mechanisms | Possibly a tighter guest window for generation calls specifically (see §7 GA-D8) |
| Guest support | ✅ Yes — P1's entire guest path | ⚠️ Guest generation is the highest-risk new surface (real LLM cost from anonymous traffic) | `guest-knowledge-query.ts`, `guest-rate-limit.ts` | Extending guest path to call generation — explicit rollout decision (GA-D10) |
| Human escalation | ✅ Yes — `escalate:true` signal | — | Unchanged | None (signal itself is not missing) |
| Human handoff (actual artifact) | ❌ No | ✅ Yes — confirmed no ticket/inbox/conversation-thread system exists anywhere in `prisma/schema.prisma` | `Feedback` model (open/reviewed/resolved, admin-triaged) and `AuditLog` (actor/action/target/metadata) are the closest existing patterns — **neither is a real handoff artifact** (no threading, no evidence-linkage, no conversation attachment) | Real build, explicitly out of this sprint (§6) — CS1.2 D9's "CS2" scope, still not started |
| Conversation transcript | ⚠️ Partial — UI-only (React state + `sessionStorage` for guests), zero backend persistence of multi-turn history | ✅ A real backend transcript, if multi-turn context is built | `AgentRun` rows are already a per-turn durable record | A linkage mechanism between turns (§8, §9 Phase B) |
| Resolution state | ✅ Yes — P1's 5-state-adjacent model (`AT24_RESOLVED`/`_UNCONFIRMED`/`ESCALATED`/`NO_COVERAGE`, `ABANDONED` client-only) | — | `recordResolutionConfirmation` | None |
| Admin/support visibility | ⚠️ Partial — `/dashboard/admin/knowledge` exists (K4 governance, unrelated to conversations); `/dashboard/admin/feedback` exists (unrelated one-shot reports) | ✅ A real admin view of support conversations/escalations | Neither existing admin view is a fit | New, tied to whatever the human-handoff decision produces |

---

## 4. Locked invariants (A–G)

Restated and re-confirmed against the current repository, not just asserted:

- **A. Evidence-first** — confirmed unchanged: a strong (`≥0.6`) KB match
  still always wins via the existing citation path; the target architecture
  (§2) only ever reaches generation when the existing path already produces
  `no-coverage`.
- **B. Account-data isolation** — confirmed structurally true today
  (`support-account-read.tool.ts` has no user-selecting input) and locked to
  remain true: any future generation module must never receive
  `support.account_read`'s output as generation input, by construction.
- **C. Mutation isolation** — confirmed: `MUTATION_MARKERS` already
  intercepts before retrieval even completes; a future generation step only
  ever runs on the `no-coverage`-and-not-`mutationIntent` branch, which by
  definition excludes every mutation-intent question.
- **D. No K3 import coupling** — confirmed zero `services/knowledge-loop/**`
  imports anywhere in the current Support tree (`support.specialist.ts`,
  `guest-knowledge-query.ts`, both grep-verified clean); locked to stay that
  way for any future generation module.
- **E. One Support engine** — confirmed: this document proposes exactly one
  new module extending the existing specialist's fallback branch, not a
  parallel orchestration system.
- **F. Honest coverage** — confirmed: `kb-answered` / `account-context` /
  `no-coverage` exist today; `kb-generated` (GA-D4) is locked as the fourth,
  structurally distinct value for any future implementation.
- **G. Safe failure** — confirmed: the existing `escalate:true` path is
  untouched by this document; any future generation failure mode (no clean
  provider output, rate limit, cost ceiling) falls through to it unchanged.

---

## 5. Conversation continuity (current state, confirmed by direct inspection)

**Confirmed gap, not assumed:** `hooks/useSupportRun.ts`'s `ask(question)`
calls `POST /api/private/agents/framework/runs` with body
`{agentType:"SUPPORT", goal:{question}}` — **no history, no conversationId,
no reference to any prior run.** `services/agent-framework/agents/support-agent.ts`'s
`goal` type is `string | {question: string}` — there is no field anywhere in
the current contract for prior turns. Each question starts a brand-new,
context-free `AgentRun`.

The brief's exact example does not work today:
```
"How does Algo Testing Pro work?"  → answered (if KB covers it)
"Can I use it for this?"           → runs as an ISOLATED question; "it" and
                                      "this" have no antecedent the backend
                                      can resolve — today's system would
                                      either mis-answer or (more likely,
                                      given no strong match for a pronoun-only
                                      query) escalate
"It's not working for me."         → same isolation problem
```

The widget's `authHistory`/`guestTurns` accumulation is **UI-only** — it
makes prior turns visible to the human user, not to the backend agent.

**This is a real, separate gap from Track 2's generation gap** — solving
generation does not solve this, and solving this does not require
generation. They compose (a multi-turn-aware system that also generates is
the fuller target) but are independent capabilities. Scoped separately in
§9 (Phase B) precisely because of this independence — building both at once
in one phase would conflate two different-risk changes.

---

## 6. Human handoff — architecture, not implementation

**Confirmed: no ticket, live-chat, or conversation-thread infrastructure
exists anywhere in `prisma/schema.prisma`.** The two closest existing
patterns:
- `Feedback` (`userId`, `type`, `message`, `page`, `status: open|reviewed|resolved`) —
  a one-shot report with admin triage (`/dashboard/admin/feedback`). No
  threading, no linkage to a specific conversation or evidence trail.
- `AuditLog` (`actorUserId`, `action`, `targetType`, `targetId`, `metadata`) —
  a generic event log, used today by K4 governance actions. Not
  conversation-shaped, not designed for a human to *respond* through.

**Neither is sufficient as-is for real human hand-off** (per the brief's
explicit instruction: mark this as a future workstream, don't pretend
existing infrastructure covers it).

Target shape (**design only, nothing here is built in this sprint**):

```
AI conversation (AgentRun trace + evidence, already durable today)
     ↓
escalate:true fires (EXISTING signal, unchanged)
     ↓
[NOT BUILT] Create/attach a support case
     — could plausibly extend Feedback's shape (status lifecycle already
       matches: open/in-progress/resolved) or be a genuinely new model;
       this document does not decide which — it is explicitly a GA-D6-
       adjacent but SEPARATE open question, not resolved here, because it
       depends on product decisions (does a human respond IN the widget?
       via email? via an external helpdesk tool?) this discovery sprint has
       no evidence to answer from the repository alone
     ↓
[NOT BUILT] Preserve conversation context — the AgentRun/AgentEvidence trace
     already IS this, durably, today; the missing piece is a human-facing
     VIEW of it (an admin route), not new storage
     ↓
[NOT BUILT] Human sees context, responds
     ↓
[NOT BUILT] Resolution — could plausibly reuse the EXISTING
     `recordResolutionConfirmation` mechanism/metadata shape if a human's
     resolution is modeled as a special case of the same "resolved" concept
     P1 already built — flagged as a promising reuse angle, not decided here
```

**Explicitly not proposed in this sprint:** a new ticket system, a live
human-chat UI, an external helpdesk integration. This is Phase D (§9) —
correctly sequenced *after* the generation and continuity work, because it
is the least-grounded-in-existing-code of everything in this document (the
brief's own instruction: mark it as future, don't build it here, don't
pretend it exists).

---

## 7. GA-D6–D10 — resolved with repository evidence

### GA-D6 — provenance for a generated answer

**Compared, as instructed:**
1. **`AgentEvidence` reuse** — `AgentEvidence.toolCallId` is nullable
   (`prisma/schema.prisma:1827`, confirmed), and `AgentStepKind` already
   contains unused `model_call` and `evidence` values
   (`prisma/schema.prisma:1678-1687`, confirmed) — a generation attempt could
   append an `AgentStep{kind:"model_call"}` then an `AgentEvidence` row
   discriminated by `source` (e.g. `"support-generated:*"`) and
   `provenance.producer`, reusing an existing `AgentEvidenceType` value
   (same CS1.2 D2a discipline — no new enum value).
2. **Minimal Support generation record** — a new, small table just for
   generated-answer metadata. Rejected as the first choice: it would
   duplicate what `AgentStep`/`AgentEvidence` already durably capture for
   every other kind of Support action, breaking the "one Support engine,
   one trace model" invariant (E) for no evidenced benefit.
3. **Run/step trace only, no evidence row** — insufficient: it would make a
   generated answer's *grounding* (which sub-threshold KB hits fed it)
   unrecoverable after the fact, unlike every other Support answer today.

**Evidenced recommendation: option 1**, `AgentEvidence` reuse — zero schema
change, consistent with every prior Support decision (CS1.2 D2, D2a), and
the two enum values needed (`model_call`, `evidence` step kinds) already
exist, unused, in the schema today. This is a recommendation for the owner
to confirm before implementation, not a unilateral decision — flagged as
still requiring sign-off in §12.

### GA-D7 — credit/cost accounting

**Confirmed existing mechanism:** every Support tool already has a flat
`creditCost` (`tool-credit-costs.ts:19-20`) charged via the same
`creditLedger.charge()` (`agent-runtime.ts:448`) every tool call in the
framework uses — there is no second billing system anywhere in A1–A15.

**Evidenced recommendation:** register the generation step as a proper A2
Tool Registry entry (e.g. `support.generate_answer`, `category: "SUPPORT"`),
the same shape as the two existing Support tools. This gets A8
authorization, A9 credit charging, and the existing evidence/step
persistence machinery **for free**, with zero new runtime mechanism —
consistent with how every other capability in this framework is added. The
exact credit cost (flat vs. tiered by provider/token count) is a product
call, not resolved here.

### GA-D8 — generation-specific rate limiting

**Confirmed existing mechanisms:**
- Guest: `guest-rate-limit.ts`, 10 requests/60s per (spoofing-resistant, last
  XFF hop) IP, disclosed as an in-process, not-distributed, best-effort
  control.
- Authenticated: no dedicated rate limiter, but the **monthly A9 credit
  allowance** (Free 500 / Pro 10,000 / Elite 50,000 / Enterprise 500,000,
  per `seed-support-kb.ts`'s sibling doc content) already throttles any
  expensive operation, generation included, once it is credit-costed per
  GA-D7.

**Evidenced recommendation:** authenticated users need **no new rate
limiter** — the existing credit ceiling already is one, once generation is
credit-costed. Guests are the genuinely higher-risk case (free vector
retrieval today; a real LLM call if generation ships to guests at all) —
the smallest additional control is likely a **tighter window specifically
for requests that reach the generation branch**, reusing the exact same
`guest-rate-limit.ts` module (parameterized, not rebuilt). Exact numbers are
a product/cost call, not resolved here.

### GA-D9 — system-instruction requirements (requirements only, not the final prompt)

Must include, evidenced by what CS1/P1/K3 already require elsewhere in this
exact codebase:
- **Knowledge grounding** — ground only in the provided (sub-threshold)
  retrieval hits; if they don't cover the question, say so plainly (same
  honesty discipline as today's `no-coverage` escalation).
- **No account-state invention** — never state or imply anything about the
  requester's account, billing, credits, or licenses (structurally
  guaranteed by GA-D2/Invariant B — this instruction is defense-in-depth,
  not the only control).
- **No financial/trading advice** — reuse the exact same house compliance
  rule the rest of the platform already carries
  (`terminology.ts`/`scanForForbiddenLanguage`), not a new invented rule.
- **Retrieved content is data, not instructions** — reuse K3-C's C7
  injection-hardening clause verbatim (same wording already proven and
  locked in `knowledge-answer-orchestrator.ts:69-80`).
- **Uncertainty → human escalation** — when ungrounded, defer to the
  existing `escalate:true` path rather than guessing (Invariant G).
- **No fabricated product behavior** — never invent a plausible-sounding
  AT24 feature or policy not present in the retrieved material.

Per the brief: **the final production prompt is not written here** — these
are requirements an implementation sprint must satisfy, not the prompt
itself.

### GA-D10 — guest vs. authenticated rollout

**Confirmed existing policy to respect:** P1's own D11/D13 lock guests to
L1, `visibility:public` only, with a disclosed, non-distributed rate
limiter — and P1 itself was scoped narrower for guests specifically because
guests are the harder authorization/abuse case. Cost compounds this for
generation specifically: a guest generation call is real, uncapped-by-any-
credit-ceiling LLM spend (guests have no A9 allowance to throttle them,
unlike authenticated users per GA-D8's finding).

**Evidenced recommendation:** **authenticated-only first**, mirroring
exactly how P1 itself phased guest reach in the original R&D roadmap (P1
widget authenticated-only, P2 guest-safe gateway added after). Extending
generation to guests is a separate, later rollout decision, gated on
observing real authenticated-usage cost and abuse data first — not decided
here, and **does not widen guest authority** beyond what P1 already granted
(guests still never reach account data or generation-fed-by-account-data
either way).

---

## 8. Implementation phases (sequential, smallest-first, no dates, no invented scope)

### Phase A — Generative Support Core
Grounded generation for the informational `no-coverage`+no-mutation-intent
case only (§2, §7 GA-D6/D7/D9 resolutions as the design basis).
- **Existing infrastructure reused:** `searchSupportKnowledge`'s
  already-computed sub-threshold hits, `lib/ai/compliance.ts`, A2/A8/A9 via
  a new registered tool, `AgentEvidence`/`AgentStep` (no schema change).
- **New files/modules expected:** one new tool implementation
  (`support.generate_answer` or equivalent), a small prompt/system-
  instruction module, specialist wiring for the new fallback branch.
- **Schema changes:** none (GA-D6).
- **Tests:** structural (no account-data import, no `services/knowledge-loop`
  import — same style as P1's existing structural test suite), unit (forced
  clean/failed generation outcomes), live E2E against the real corpus
  (matching the existing `validate-agent-support.ts`/`validate-support-p1.ts`
  house style).
- **Production verification:** re-run the exact live-smoke queries from this
  document (§9) against the merged tree, matching every prior phase's
  closure pattern in this program.
- **Explicit non-goals:** no multi-turn context (Phase B), no guest rollout
  (GA-D10, deferred), no new investigation tooling (Phase C).

### Phase B — Conversation-aware Support
Multi-turn context (§5's confirmed gap), if Phase A's real usage shows it's
needed before Phase C.
- **Existing infrastructure reused:** `AgentRun` as the per-turn durable
  record already exists; needs a linkage field/mechanism between runs
  (design TBD at implementation time, not decided here).
- **New files/modules expected:** TBD at implementation scoping.
- **Schema changes:** likely — a linkage between runs is not free in the
  current `AgentRun` shape; this phase's own scoping pass must resolve it,
  not assumed here.
- **Non-goals:** does not change Phase A's generation safety boundary.

### Phase C — Troubleshooting / investigation
Richer informational assistance, reusing existing authorized Support
capabilities only (still L1–L2, still evidence/generation-fallback, no new
authority).
- **Non-goals:** no new account-mutation capability (would be L3, explicitly
  out of scope for this whole program per P1's own D13).

### Phase D — Human Handoff
Only if Phase A–C usage shows the existing `escalate:true` signal alone is
insufficient (§6). Explicitly the least-evidenced phase in this document.

### Phase E — Support Operations
Admin visibility, provenance review, resolution analytics, cost/rate
monitoring — the operational layer once A–D exist to monitor.

---

## 9. Five concrete test conversations

1. **`how its work`** (casual informational)
   `user → ACCOUNT_MARKERS/MUTATION_MARKERS: no match → retrieval: <0.6 (confirmed live) → TODAY: escalate. WITH PHASE A (not built): generative fallback using sub-threshold hits → coverage:"kb-generated" if clean, else same escalate.`
2. **`how does algo testing pro work`** (product question)
   `user → no marker match → retrieval: CONFIRMED zero coverage (grep of scripts/seed-support-kb.ts for "algo test"/"backtest" returns no matches — no KB row mentions this product at all) → TODAY: escalate. WITH PHASE A (not built): generative fallback would still have nothing grounded to draw on either — the honest outcome is the SAME escalate, not a fabricated answer (Invariant "no fabricated product behavior," GA-D9) — this specific gap needs KB content (a Track-1-style addition), not generation.`
3. **`what plan am i on`** (account question)
   `user → ACCOUNT_MARKERS matches ("plan") → EXISTING support.account_read path (L2) → cited account-status answer. UNCHANGED by this entire document.`
4. **`cancel my subscription`** (mutation)
   `user → MUTATION_MARKERS matches → EXISTING escalate:true, "requires-an-account-change..." reason. UNCHANGED by this entire document — Phase A's generation branch is never reached, by construction (Invariant C).`
5. **`my backtest is broken and nothing is working`** (failure/handoff)
   `user → no marker match → retrieval: CONFIRMED no backtest-specific KB content exists (same grep as #2); the general "something isn't working" row (Track 1) may retrieve on the "nothing is working" phrase, but not on "backtest" specifically → TODAY: likely escalate, static "Talk to a human" link only. WITH PHASE A: generative fallback attempts a grounded answer from the general-troubleshooting content only — honestly cannot address the backtest specifics (again, a content gap, not a generation gap), so a clean answer would (correctly, per GA-D9) redirect to human support rather than invent a backtest-specific fix. WITH PHASE D (not built, future): a real handoff artifact carrying the conversation context to a human, instead of just a static link.`

---

## 10. Non-goals (this document)

No implementation. No schema migration. No new Support generation code. No
UI redesign. No provider integration. No rewrite of `support.specialist.ts`
beyond what an eventual Phase A implementation sprint scopes precisely. No
change to existing account authority boundaries. No import of
`services/knowledge-loop/**` into `services/agent-framework/**`. No second
support engine. No second knowledge system. No new LLM provider. No
modification to unrelated AI Assistant/K3/K4 code. No speculative UI. No
ticket/handoff system built (§6 is architecture-only). No dates, no
committed scope beyond what's written here.

---

## 11. Owner decisions required before any implementation

- Confirm or amend the GA-D6 recommendation (`AgentEvidence` reuse).
- Confirm or amend the GA-D7 recommendation (register generation as an A2
  tool, reuse `creditLedger.charge()`).
- Confirm or amend the GA-D8 recommendation (authenticated = existing
  credit ceiling is sufficient; guest = tighter `guest-rate-limit.ts`
  window).
- Confirm or amend the GA-D10 recommendation (authenticated-only first).
- Decide whether Phase B (multi-turn context) ships before or after Phase A
  reaches production, or together — this document deliberately did not
  pre-decide phase ordering beyond "smallest, least-coupled first."
- Decide the human-handoff artifact's actual shape (§6) — explicitly not
  evidenced enough in the current repository for this document to
  recommend one option over another.
- Authorize (separately, later) which phase, if any, becomes the next
  implementation sprint.

---

## 12. Architecture status

```
ARCHITECTURE STATUS:
- Existing Support foundation: CS1 + P1 + Track 1, all merged, all live,
  fully reconciled above (§1) with exact file:line citations, nothing
  assumed.
- Track 2: R&D merged (90e2d7e), GA-D1-D5 locked and carried forward
  unchanged, GA-D6-D10 resolved with repository evidence in §7 (each a
  recommendation for owner confirmation, not a unilateral decision).
- Target Support Chat: one routing diagram (§2), one experience across
  guest widget / authenticated widget / full page — mostly ALREADY BUILT
  (account/mutation/strong-match paths); exactly one new box (generative
  fallback) is not yet built.
- Gaps: generation (Track 2, unimplemented), multi-turn context (confirmed
  absent, §5, independent of generation), real human-handoff artifact
  (confirmed absent, §6), backtest/product-specific troubleshooting depth
  (not confirmed either way for every possible question - §9 items 2 and 5
  flagged as needing a live corpus check, not assumed).
- GA-D6: AgentEvidence reuse recommended, zero schema change, evidenced by
  the existing nullable toolCallId + unused model_call/evidence step kinds.
- GA-D7: register generation as an A2 tool, reuse creditLedger.charge() -
  zero new billing mechanism.
- GA-D8: authenticated needs no new limiter (existing credit ceiling
  suffices once GA-D7 ships); guest needs a tighter window on the existing
  guest-rate-limit.ts module, not a new one.
- GA-D9: six requirements listed (§7), final prompt NOT written.
- GA-D10: authenticated-only first recommended, mirroring P1's own guest-
  reach phasing; does not widen guest authority.
- Human handoff: NO real infrastructure exists (confirmed via schema
  inspection); Feedback/AuditLog are the closest but insufficient
  precedents; target shape sketched (§6) but explicitly not designed in
  implementation detail - correctly sequenced as Phase D, the
  least-evidenced phase.
- Conversation continuity: CONFIRMED ABSENT today (§5) - every question is
  an isolated AgentRun; UI-level transcript accumulation is cosmetic only,
  not backend memory. Independent gap from generation; sequenced as Phase B.
- Schema impact: NONE required for Phase A (GA-D6 resolved without
  migration); Phase B likely requires one, not scoped here; Phase D likely
  requires one, not scoped here.
- Implementation phases: A (generative core) -> B (conversation continuity)
  -> C (troubleshooting/investigation) -> D (human handoff) -> E (support
  operations), smallest/least-coupled first, no dates, no phase started in
  this sprint.
- Risks: real LLM cost from generation (mitigated by GA-D7/D8's credit-
  ceiling reuse); guest abuse surface if GA-D10 is not respected; scope
  creep if Phase B/C/D are pulled forward before Phase A's real usage data
  justifies them.
- Owner decisions required: listed in full in SS11 - five recommendations
  to confirm/amend, two sequencing decisions, one design-shape decision
  (human handoff), and separate authorization for whichever phase becomes
  the next implementation sprint.
```

**STOP. No implementation without explicit, separate owner authorization —
same gate discipline as every phase in this program.**
