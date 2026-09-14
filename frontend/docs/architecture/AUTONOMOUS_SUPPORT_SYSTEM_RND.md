# Autonomous Support System — R&D / Architecture

**Program:** AT24 Autonomous Support System (working name)
**Stage:** R&D + architecture decision lock. **Implementation NOT authorized.**
**Base:** `origin/main` @ `0fcdb7f` (CS1 live in prod, Beta GO declared `6203e38`, K3-C implementation in progress on an unmerged branch, K4.2 blocked on K3-C)
**Depends on / builds on:** CS1 (`docs/architecture/CS1.1-*`, `CS1.2-*`), K0–K3 Knowledge Loop (`KNOWLEDGE_CONTRACT.md`, `KNOWLEDGE_GOVERNANCE_CONTRACT.md`, `KNOWLEDGE_RETRIEVAL_CONTRACT.md`, `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`, `K3C_DECISION.md`), K4.1 (`k4-knowledge-governance.md`), the AN A1–A15 Agent Framework
**Gate today:**
```
Support R&D          🔓 ACTIVE  (this document)
Implementation        🔒 NOT AUTHORIZED
CS1                   ✅ CLOSED — immutable milestone `63d4eb1`, not reopened here
K3-C                  ⏳ continues independently (C1–C6 done, C7/C8 + smoke remain)
K4.2                  🔒 still blocked until K3-C closes
```

---

## 0. Executive summary

CS1 shipped a genuinely real, evidence-grounded, read-only support agent: retrieval from a governed `scope=support` knowledge corpus, a deterministic strong-match/escalate gate, no LLM in the decision path. That is **L1–L2** on the human-dependency scale defined below (§4) — it can *answer from evidence* and *tell you when it can't*, but it cannot *investigate* (multi-step, multi-tool reasoning over a specific account) or *act* (perform an authorized change). Every 2026-generation platform researched (Intercom Fin, Salesforce Agentforce, Zendesk, Ada, Sierra, Decagon) has converged on the same three-layer shape — **retrieve → reason/plan → act, gated by a permission layer independent of the model** — and reports **Autonomous Resolution Rate**, not "AI replied," as its primary metric.

The good news for AT24: **the two hardest, most failure-prone layers in that industry pattern — the reasoning/planning boundary and the permission/trust layer — are exactly what the A1–A15 Agent Framework already is.** AT24 is not starting from a chatbot; it is starting from a governed agent runtime with authorization, evidence, credit accounting, and evaluation already built and production-verified across three other agents. What AT24 is missing is *narrower* than "build a support platform": a widget, an intent/context layer, a small set of new authorized read (and later, write) tools, a resolution-confirmation contract, and a measurement framework. §11 recommends **AT24 owns its control plane and buys nothing** for the reasoning/permission core, with one narrow buy option (§10.4) for pure conversational-channel plumbing (voice/WhatsApp) if AT24 ever needs those channels.

This document does not authorize any of that. It defines what "Resolved" means, the six autonomy tiers and what AT24 may do at each, the security boundary that must hold at every tier, and a roadmap whose *phases* — not just their order — come from the research and the capability gap, not from assumption.

---

## 1. Industry benchmark

### 1.1 What was researched

Five vendors + the general 2026 "autonomous resolution" literature. Primary sources cited inline; full source list in §14.

| Vendor | Positioning | Architecture (as described in vendor/analyst material) |
|---|---|---|
| **Intercom Fin** | Packaged AI agent bolted onto Intercom's inbox | 3 layers: **App Layer** (training/deployment), **AI Layer** (RAG engine), **Model Layer** (custom "Apex" LLM fine-tuned on real support transcripts). "Guidance" (behaviour rules) + "Tasks/Procedures" (multi-step actions) sit on top of the RAG core. Reports ~67–76% resolution, up to ~93% for some teams; priced **per outcome** ($0.99/resolution, $9.99/qualification), never per seat. |
| **Salesforce Agentforce (Service Agent)** | Full agent platform grounded in the CRM | **Reasoning Engine** ("Atlas" — plans + self-corrects across multi-step tasks, can run cooperative "agent swarms"), a **Trust Layer** (the security gatekeeper — explicitly separate from the reasoning engine), an **Action Layer** (executes via Flows/APIs). Grounded on **Data 360**, a unified customer-data platform. Each agent has an explicit "Job Description" and a permission scope that *limits*, not just informs, what it can do. |
| **Zendesk AI Agents** | "Resolution Platform" — agents + copilots + knowledge + workflow + governance unified | Positions itself explicitly against "deflection-based bots." Multi-channel (chat/email/voice) with shared context. Trained on a claimed 20B+ real support interactions. Ships a **built-in learning loop** — the platform is designed to improve from its own resolved/escalated outcomes, not just serve static content. Also moved to **outcome-based pricing** in 2026. |
| **Ada** | Enterprise CX, "agentic AI tier" positioning | **Reasoning Engine™** (dual-model) — interprets intent, retrieves knowledge, *plans steps*, distinct from a single-shot RAG answer. **Playbooks** (multi-step workflows), **Actions** (API connections — refunds, rebookings, account recovery), **Coaching** (iterative improvement from a human reviewing transcripts), **Performance Center** (analytics). Claims 80–84% autonomous resolution across voice/chat/email. |
| **Sierra AI** (newer, high-valuation 2026 entrant) | "Agent OS" | 4 layers: **Agent OS** (production runtime), **Agent Studio** (no-code builder), **Agent SDK** (code-first), **Agent Data Platform** (cross-session/cross-channel customer context). Emphasis on managed, white-glove deployment. |
| **Decagon** (newer, technical-buyer entrant) | Enterprise AI support, engineer-facing | **Agent Operating Procedures (AOPs)** — plain-English procedure definitions that CX teams can edit post-launch, but the *integrations, APIs, and guardrails* are explicitly engineer-built up front — the platform does not pretend the hard part is no-code. |

### 1.2 The pattern, extracted

Every one of these — regardless of vendor framing — is the **same pipeline** under different names:

```
retrieve/ground  →  plan/reason (multi-step)  →  ACT via a permission-gated tool layer  →  confirm resolution  →  learn
```

The two universal, non-negotiable separations:

1. **Reasoning is not the same module as permission.** Salesforce names this explicitly (Reasoning Engine vs Trust Layer); Ada separates Reasoning Engine from Actions; the security research (§1.4) states it as an industry-wide principle: *"guardrails govern AI output; permission rules govern AI actions."* No vendor lets the LLM decide what it's *allowed* to do — only what it *proposes* to do.
2. **"Resolved" is a confirmed system state, not a generated string.** Every vendor's pricing model (per-outcome, not per-message) forces this distinction structurally — Intercom and Zendesk literally cannot bill for "the AI replied," only for a verified resolution/procedure/disqualification. This is the strongest external validation for the CS1.2 D5/D6 pattern AT24 already locked (no answer text without evidence; a distinct `escalate` signal).

### 1.3 Strengths / weaknesses — what's genuinely useful vs marketing

| Genuinely useful (worth AT24 adopting the *principle* of) | Marketing / not directly applicable |
|---|---|
| The Reasoning-vs-Trust-Layer separation (§1.2.1) — **AT24already has this** (A5 Supervisor/Specialist vs A8 Authorization, CS1.1 §1.1, §1.4) | The specific "Apex model" / "Atlas Reasoning Engine" branding — proprietary fine-tunes AT24 has no need or ability to replicate, and doesn't need to: AT24's providers (Claude/Gemini/OpenAI, K3-B/C) are already general-purpose and the *system* — not the model — carries the reliability |
| Outcome-based measurement (§7) instead of message-count vanity metrics | Resolution-rate headline numbers themselves (67–93%, 80–84%) — **not comparable across vendors** (the research explicitly flags measurement inconsistency: "resolution" vs "containment" vs "deflection" are conflated); AT24 must define its own measurement before quoting a target number |
| Multi-step "Playbooks"/"Procedures"/"AOPs" as a named, inspectable artifact (not an improvised chain-of-thought) — maps directly onto AT24's existing deterministic **Specialist.planTools()** pattern (A5) | "Agent swarms" / "cooperative multi-agent" framing (Agentforce) — AT24's own G04 lock ("don't build eight independent agent runtimes... one shared runtime, specialists are planning ROLES") already rejected the multi-runtime version of this idea for good reasons; a single Support specialist with a richer plan is the right analogue, not a swarm |
| A built-in **learning loop** from resolved/escalated outcomes back into knowledge (Zendesk) — this is architecturally *exactly* K4 (Knowledge Candidate → human review → publication), already designed, just blocked on K3-C | "No-code" claims (Decagon's own material concedes integrations/guardrails are still engineer-built) — AT24 should not expect a no-code path to authorized actions either |
| Explicit per-agent "Job Description" + scoped permissions (Agentforce) — this is CS1.2 D4's `AgentTypeSpec.defaultPermissions` allowlist, already built | Channel breadth (voice, WhatsApp, "autonomous workforce") — not a 2026 AT24 requirement; scoped out (§13) |

### 1.4 Security research (feeds §5 directly)

Independent 2026 research on agentic-AI incidents (not vendor material) is unambiguous and directly relevant to AT24's authority design:

- **88% of organizations reported a confirmed or suspected AI-agent security incident** in the past year; only 21% have visibility into what their agents access or which tools they call.
- The concrete failure mode named repeatedly: an agent given a narrow task ("check order status") accesses adjacent data ("payment records, customer notes, internal pricing") *because the model judged it relevant* — not because it was authorized.
- The stated fix, industry-wide: **runtime enforcement of the action itself**, independent of the model's stated intent — "a malformed or out-of-policy action can be blocked whether it came from an attacker, a bug, or the model's own bad reasoning." This is a direct, external description of what AT24's **A8 AuthorizationService** already does (re-checks permission/autonomy/prohibited-combination at the *tool call*, never trusts the planner).

**Conclusion for AT24: the architecture CS1 already inherited from A1–A15 is not behind the industry — it is ahead of what the research says most deployed agentic-support systems actually have.** The gap is capability (tools, actions, tiers), not governance architecture.

---

## 2. AT24 capability map

### 2.1 CS1 today (as merged, `63d4eb1`)

```
Website Widget        ❌ none — /dashboard/support is a full authenticated page, not a widget
Support Gateway        ⚠️  partial — the A15 API seam (agent-run-service, ownership-scoped) IS a
                        real gateway, but only for authenticated dashboard callers
Intent / Context        ❌ none — the specialist goes straight to retrieval; no classifier
                        (K3-B/C already built exactly this shape for the main Assistant —
                        services/knowledge-loop/classifier/classify.ts — reusable pattern, §2.3)
Knowledge               ✅ real — scope=support K1 corpus, eligibility-filtered retrieval,
                        governed lifecycle (K1_DECISION, KNOWLEDGE_CONTRACT.md)
Reasoning               ✅ real but narrow — supportSpecialist.planTools() is deterministic
                        (kb, +account when account-scoped) — no multi-step investigation
Deterministic Tools     ✅ real — support.knowledge_search, support.account_read — both
                        read-only, both structurally incapable of a write (no write path exists)
Resolution              ⚠️  partial — `coverage`/`resolved`/`escalate` exist (CS1.2 D5/D6) but
                        there is no confirmation step ("did this actually fix it for you?") —
                        see §3
Verification            ✅ real — A6 output-integrity gate (evidence lineage, no fabricated
                        citation, no trading-signal leakage) runs on every terminal run
Escalation              ⚠️  signal only — `escalate:true` + a reason string; **no actual hand-off
                        mechanism** (no ticket, no queue, no human-visible context package) — CS1.2
                        D9 explicitly deferred this to "CS2"
Learning                ❌ none — no candidate capture from a support conversation (this is K4,
                        blocked on K3-C by design; §12)
```

### 2.2 Target shape (industry pattern, §1.2, mapped onto AT24's existing infrastructure)

```
Website Widget      →  Support Gateway  →  Intent/Context  →  Knowledge  →  Reasoning
     →  Deterministic Tools  →  Resolution  →  Verification  →  Escalation  →  Learning
```

| Target stage | AT24 infrastructure that already exists to build it on | New surface needed |
|---|---|---|
| Website Widget | none yet | a client component + a session-aware/guest-aware mount point at root layout (not dashboard-only) |
| Support Gateway | A15 API seam (`agent-run-service.ts`, ownership-scoped, bounded `tick()`) is the *authenticated* half already | a guest-safe variant — same runtime, a synthetic/anonymous caller identity, tool binding restricted to read-only KB search only (never `support.account_read`) |
| Intent/Context | K3-B/C's classifier (`classify.ts` — intent precedence, freshness, privacy class) is the *exact same problem*, already solved and hardened for the main Assistant | reuse the pattern (not the module — K3-C's classifier is Assistant-scoped); a support-specific intent set (billing / license / troubleshooting / product / account-change / abusive) |
| Knowledge | K1 `scope=support` corpus — real, governed | more product-authored content (K4-dependent for the *governed* path; a manual admin-authored interim is not blocked) |
| Reasoning | A5 Specialist pattern (`supportSpecialist`) — deterministic plan+synthesis | a richer plan: multi-tool investigation (e.g. "check my license status AND look up the activation-limit policy") — still deterministic, no LLM required for v1 |
| Deterministic Tools | A2 Tool Registry + A8 Authorization (permission/autonomy floor, prohibited combos) | new **read** tools first (order/ticket status if AT24 ever has a ticket system; more account-domain reads); new **write** tools only at L3+ (§4), each individually authorized, never a generic "do anything" action tool |
| Resolution | `coverage`/`resolved` fields | an explicit **resolution-confirmation contract** (§3) — AT24-specific, not copied from a vendor |
| Verification | A6 integrity gate — already real, already proven (CS1 signal-language proof) | extend the forbidden-content scan to the new write-tool outputs when those exist |
| Escalation | `escalate` signal | an actual hand-off artifact: conversation transcript + evidence trail + account snapshot handed to a human queue — "CS2" scope, not started |
| Learning | none (blocked) | K4 Knowledge Candidate pipeline — architecture already fully designed (K4.1, K4-D1..D14), implementation blocked on K3-C by explicit owner decision |

### 2.3 What this means concretely

**Nothing in the target pipeline requires new architecture.** Every stage maps onto an A1–A15 or K1–K4 component that already exists, is production-verified, or is fully designed and gated. The work is: (a) a widget, (b) a guest-safe gateway variant, (c) an intent/context specialist upgrade, (d) new tools per autonomy tier, (e) a resolution-confirmation contract, (f) an actual escalation artifact, (g) K4 (blocked, not this program's to unblock).

---

## 3. Autonomous-resolution model

### 3.1 The distinction the brief asks for

> "Resolved" ≠ "I generated an answer."

CS1 already drew half of this line (`coverage: "no-coverage"` → never claims resolution). What's missing is the *positive* half: even a `kb-answered` response today is "the agent found and cited relevant evidence," not "the agent confirmed the user's problem is fixed."

### 3.2 Proposed definition (LOCKED as the target; not implemented here)

**`AT24_RESOLVED`** requires ALL of:

1. **Evidence-grounded** (already true) — every claim traces to a cited `AgentEvidence` row (A6).
2. **Intent-matched** — the resolution addresses the *specific* classified intent, not a generic related answer (requires the Intent/Context stage, §2.2).
3. **No outstanding action required of AT24** — either (a) the answer alone resolves it (informational/troubleshooting), or (b) an authorized tool call completed a state change and the system verified the new state (e.g. re-read the license status after a tool "reactivate" call and confirmed it changed) — never "the tool call returned 200" as the confirmation.
4. **User-confirmed OR silence-confirmed** — the strongest signal is an explicit "yes, that solved it" (industry precedent: Ada's Coaching loop, Zendesk's "customer-confirmed resolution" metric, §7). Absent that, a conversation that ends without a follow-up question or an escalation request within a defined window (industry default: session end / 24h) is **provisionally resolved**, tracked separately from confirmed (§7 — `Correct Resolution Rate` vs `Customer-confirmed resolution`).
5. **Not escalated** — if `escalate:true` fired at any point in the conversation, the terminal state is `ESCALATED`, never `AT24_RESOLVED`, even if the human later fixed it (that outcome is `HUMAN_RESOLVED`, a different bucket for the measurement framework, §7).

### 3.3 Terminal states (the full set, not just "resolved")

```
AT24_RESOLVED           — §3.2, all 5 conditions met
AT24_RESOLVED_UNCONFIRMED — conditions 1-3 met, no explicit/silence confirmation yet
ESCALATED               — escalate:true fired; handed to a human with full context
NO_COVERAGE              — honest "don't know," already real in CS1 (coverage: no-coverage)
ABANDONED                — user left before any terminal state (measured, not blamed on the agent)
```

This five-state model — not a binary resolved/not-resolved — is what makes the measurement framework (§7) meaningful and prevents exactly the "resolution vs containment vs deflection" conflation the research (§1.3) flags as the industry's current measurement problem.

---

## 4. Human-dependency model

Six tiers, L0–L5, each with an explicit **can / cannot** list. This is the direct answer to "what is AT24 allowed to do autonomously, and where must a human be involved."

| Tier | Name | Can do | Cannot do | AT24 component today |
|---|---|---|---|---|
| **L0** | Static self-service | Serve a published FAQ/doc page, no conversation | Answer a novel question, use any tool | The existing marketing/docs pages — not agentic at all |
| **L1** | AI answers | Retrieve + cite from the governed KB; escalate when no strong match | Investigate anything account-specific; call any tool beyond KB search | **CS1 today**, for non-account questions |
| **L2** | AI investigates | Call **read-only** tools across multiple domains (KB + the requester's own plan/subscription/purchase/license) to assemble a fuller picture; still cites everything, still escalates on gaps | Perform any write; access another user's data; infer/guess account state not returned by a tool | **CS1 today**, for account-scoped questions (`support.account_read`) — this tier is already built |
| **L3** | AI performs an authorized action | Execute a **specific, individually-authorized, reversible-preferred** action a human pre-approved as safe for autonomous execution (e.g. resend a verification email, regenerate a license activation slot within policy limits, apply a documented, ceiling-bounded credit) — always re-verifies the resulting state (§3.2.3) and logs it exactly like a financial transaction | Invent a new action not in the pre-approved tool set; act without the specific permission grant; combine two permissions the platform has locked as mutually exclusive (A8's `PROHIBITED_PERMISSION_COMBINATIONS` pattern, already built for trading permissions — the same mechanism applies here) | **Not built.** No write tool exists for Support today. |
| **L4** | AI + human-in-the-loop | Prepare a fully-specified action (what, why, evidence) and present it for **one-click human approval** before executing — for actions judged too consequential for L3 (refunds above a ceiling, account deletion, license revocation) | Execute without the approval click; the "approval" step cannot be another AI | **Not built.** Maps onto AF-v1's dormant `awaiting_approval` run status (A4/A8 — deliberately unreachable in v1, exactly the right primitive for this) |
| **L5** | Mandatory human escalation | Recognize categories that must **never** be autonomous (see §5) and route immediately, with full context, no autonomous attempt | Anything — by definition, L5 is "the AI's only job is to get out of the way fast and correctly" | **Partial.** `escalate:true` exists; the actual hand-off artifact (§2.2 "Escalation") does not |

**Locked principle:** a tier is a property of the *permission grant on a specific tool*, not a global "trust level" toggle — this is exactly how A8's `permissionAutonomyFloor` already works (`CAN_GENERATE_SIGNAL` requires autonomy≥1, `CAN_EXECUTE_ORDER` requires autonomy≥3, in the trading domain). The Support domain reuses the identical mechanism with new permission keys per new tool, never a parallel authority system.

---

## 5. Security + authority model

### 5.1 The non-negotiable rule

**No LLM output may ever be treated as account state, and no LLM output may authorize its own action.** Both halves of this are already locked platform-wide (A8: "the planner never invokes application code directly"; CS1.2 D4: `support.account_read` returns only what a real DB query returned, never inference). This program extends the *scope* of what's readable/actionable; it does not touch the rule.

### 5.2 Identity classes and what each may reach

| Identity | Can reach | Cannot reach |
|---|---|---|
| **Anonymous visitor** | Public-visibility, `scope=support` KB only (same eligibility filter CS1 already uses, `visibilities:["public"]` — narrower than CS1's current `["public","customer"]`, since a guest is not a customer) | Any account tool; any `visibility=customer` row; the authenticated widget's conversation history |
| **Authenticated user** | Everything anonymous can, plus `visibility=customer` KB, plus **their own** account-domain reads (CS1's existing `support.account_read` scope: plan/subscription/purchases/licenses — status only, per CS1.2 D4's existing "never secrets/provider-refs/amounts" rule) | Any other user's data (enforced identically to CS1 — `ctx.userId` from session, never from input); `visibility=admin`/`internal` KB |
| **L3+ action authority** | A specific, individually-granted permission to call a specific write tool, only on their own account, only within the tool's own policy ceiling (e.g. "regenerate license activation" has a documented max-per-period, exactly like A9's credit ledger already enforces spend ceilings) | Anything not explicitly granted; any action on billing/credits/purchases/licenses that is irreversible or exceeds a ceiling — those are **structurally L4/L5**, not a permission the widget can hold at all |

### 5.3 Category-specific rules (the brief's explicit list)

- **Billing / credits:** read-only at L2 (current balance/plan, already built). Any *change* (refund, credit grant, plan downgrade) is **L4 minimum** — human-approved, never autonomous, regardless of amount. Rationale: financial reversals have asymmetric downside and the platform (per §1.4's own research) is explicitly the highest-incident-rate category industry-wide.
- **Licenses:** read-only status at L2 (built). A *reissue/reactivation within a documented, ceiling-bounded policy* (e.g. "one free reactivation per 90 days, unlimited beyond that requires a human") is the canonical **L3** example — bounded, reversible-adjacent, policy-encoded, not left to model judgment.
- **Purchases:** read-only at L2 (built). Refunds are **L4/L5** per the CS1.2-inherited refund policy already published in the seeded KB ("non-refundable for the current period... reviewed by a human, not automatic").
- **Product access:** read-only entitlement status at L2. Granting/revoking access is **L4**.
- **Sensitive requests** (PII, security, "delete my account"): **L5 always** — CS1.2's existing disclaimer ("this assistant cannot change your account... hands off to human support") is the correct posture and does not change with more tools; it gets a *faster, better-contexted* hand-off (§2.2), not more autonomy.
- **Financial/trading-related support:** explicitly **out of scope for this program** — any question that touches trading advice, signals, or execution is not a support question and must route to the existing A6-governed trading agents (RESEARCH/MARKET_INTELLIGENCE/STRATEGY_RESEARCH) or be declined per the platform's standing "not financial advice" boundary, never answered by the Support agent reaching outside its domain.
- **Destructive actions** (delete, revoke, cancel-permanently): **L5 always**, full stop, regardless of who asks or how the request is phrased. No permission tier above L4 for a destructive action is proposed by this document, and none should be authorized without a separate, dedicated security review.

### 5.4 The account-state invariant

Every new read tool follows CS1's `support.account_read` shape exactly: **the tool's output is the entire truth the agent is allowed to state about the account.** The specialist's synthesis is permitted to *cite* the tool output; it is never permitted to *elaborate* on it ("your account looks like it might also..."). This is the same evidence-only, no-restated-prose discipline CS1.2 D6 already locked for the KB, extended to account data. It is also what keeps every future write tool auditable: a write tool's *input* must be traceable to specific evidence + a specific granted permission, exactly like A9's credit-charge reservation pattern already requires an idempotency key traceable to a specific run step.

---

## 6. Widget / UX architecture

### 6.1 Layout / mount point (verified against the current codebase)

There is **one** root layout (`app/layout.tsx`) shared by every route — public marketing pages have no shared layout of their own (each hand-imports its own Navbar/Footer). The only place a widget can appear on both public and dashboard pages is the root layout, not `app/dashboard/layout.tsx` (where the existing `FeedbackWidget` lives today, dashboard-only). `FeedbackWidget.tsx` is a directly reusable **shell pattern** (fixed-position launcher pill, `Modal` primitive for the panel, `useToast` for status) — the new widget should follow its conventions, not invent new ones, but must mount at root, not in the dashboard shell.

### 6.2 Launcher and panel

- **Bottom-right floating launcher**, consistent with `FeedbackWidget`'s existing `fixed bottom-6 right-6 z-40` convention and near-universal industry placement (confirmed in the UX research — no vendor deviates from bottom-corner).
- **Popup panel, not a full page** — a slide-up/slide-in panel (not a separate route), so the widget survives page navigation without losing conversation state; CS1's current full-page `/dashboard/support` becomes either (a) deprecated in favor of the widget, or (b) kept as a "expand to full page" affordance from within the widget — a decision for the implementation sprint, not locked here.
- **Mobile:** the panel becomes full-screen on small viewports (standard pattern; no vendor researched does a fixed small popup on mobile).

### 6.3 Anonymous → authenticated transition

- A guest's conversation starts unauthenticated (L1 only, §4). If the guest logs in mid-conversation (or the widget detects an existing session), the **same conversation thread continues** and gains L2 capability (account tools become available) — never a silent restart. This requires a stable conversation identity that survives the anonymous→authenticated transition, which does not exist today (CS1's conversation shape is per-authenticated-run only).
- A guest is never shown an "ask about your account" affordance — the widget's own UI reflects the tier, not just the backend enforcing it (defense in depth: UX-level + authorization-level, matching CS1's own pattern of never even rendering an escalation-to-billing-change button since the backend can't do it either).

### 6.4 Conversation persistence, attachments, citations, streaming

- **Persistence:** the conversation should survive a page reload/navigation within the same session (localStorage-backed thread pointer + server-side history, following the existing `services/ai/*` conversation persistence pattern already used by the main Assistant — reuse the pattern, not the module, per CS1.2 D1's strict-separation lock).
- **Attachments:** out of scope for v1 (no vendor's core resolution loop depends on file upload; adds a real security surface — scanning, storage, PII — better deferred).
- **Source/citation visibility:** CS1's evidence-first design (citations reference real `AgentEvidence` rows, never restated prose) is a strict *improvement* over most vendors researched (which show "sources" as a UI nicety, not a structural integrity gate) — the widget must surface citations, continuing to make CS1's honesty visible rather than hiding it behind a "here's your answer" bubble.
- **Typing/streaming:** the research is explicit that a non-intrusive typing indicator is expected UX; CS1's runtime is `tick()`-bounded/resumable (not token-streaming) — the widget should show a "working on it" state driven by the real advance-loop (exactly as `app/dashboard/support/page.tsx` already does), never a fabricated typing animation unconnected to real progress (matches the platform's house no-fabrication rule).

### 6.5 Escalation UI

- A visible, always-available "talk to a human" affordance, not only a system-triggered escalation — the research is explicit that forcing a user through failed AI attempts before allowing escalation causes drop-off ("67% of users leave and never return after getting stuck in a loop"). CS1.2's `escalate:true` should remain the automatic trigger; a manual override must also exist.
- On escalation, the UI shows the user **what was handed to the human** (the same transcript + evidence + account-snapshot the human queue receives, §2.2) — transparency, not a black-box "connecting you to an agent."

### 6.6 Proactive assistance

Explicitly **deferred, not designed here.** Proactive triggers (e.g. "we noticed your license is expiring — need help?") are a genuinely different capability (requires an event/trigger system, not a conversation-initiated one) and depend on Automation infrastructure (separate program, currently mid-observation-window per the Beta Launch Lock). Listed for completeness per the brief; not part of any phase in §9 below.

---

## 7. Measurement framework

### 7.1 Primary metric

**Autonomous Resolution Rate** = `AT24_RESOLVED conversations ÷ total conversations the agent took on` (using the §3.3 terminal-state model — a conversation that never reached L1+ engagement, e.g. abandoned before any response, is excluded from the denominator, matching the formula the research confirms as industry-standard). This replaces "number of AI messages" as the headline number everywhere it would otherwise be reported (dashboards, any future admin metrics surface).

### 7.2 Full metric set

| Metric | Definition | Why it matters (vs just Autonomous Resolution Rate) |
|---|---|---|
| Autonomous Resolution Rate | §7.1 | Primary. The industry's own stated north star. |
| Correct Resolution Rate | `AT24_RESOLVED` conversations where the evidence cited was actually correct/current (sampled human audit, or K4's future review loop) | Catches the case a confident, cited, but *wrong* answer looks identical to Autonomous Resolution Rate — the research's "resolution vs containment" warning applies here too |
| First Contact Resolution | Resolved (by AI or human) within one conversation, no re-contact | Traditional CX metric; kept for comparability with any legacy/human-support baseline |
| Human Escalation Rate | `ESCALATED ÷ total` | The direct complement of autonomous resolution; tracked as its own number, not derived, since escalation timing/reason matters independently |
| Repeat Contact Rate | Same user, same unresolved topic, within N days | Detects a false "resolved" (AI or human) — a silent-confirmed resolution that wasn't real |
| Unsupported Answer Rate | Any answer the A6 integrity gate would have rejected, or did reject in dev/staging | Should trend to zero by construction (CS1's structural gate), tracked as a canary, not a target to "improve" |
| Hallucination/Error Rate | Any answer citing evidence that doesn't support the claim (post-hoc audit sample) | Distinct from Unsupported Answer Rate — this catches a *technically-cited* but misleading synthesis, which A6 does not catch today |
| Average Resolution Time | Time from first message to terminal state | Standard; watch for gaming (fast wrong answers vs slow correct ones — pair with Correct Resolution Rate) |
| Tool Success Rate | Successful tool calls ÷ attempted, per tool | Operational health, same shape as A9's existing per-tool credit/cost tracking |
| Knowledge Coverage | % of classified intents with at least one `active` KB row scoring above the strong-match threshold (CS1's existing 0.6) | Directly actionable — tells AT24 *what to author next*, feeding K4's candidate pipeline |
| Cost per resolved issue | Total credits/API cost ÷ `AT24_RESOLVED` count | AT24 already has real, non-placeholder cost accounting infrastructure to build this on (A9 credit ledger) — genuinely better-positioned than most vendors researched, who report cost only as a black-box price-per-outcome |
| Customer-confirmed resolution | `AT24_RESOLVED` where §3.2 condition 4 was an **explicit** confirmation, not silence-inferred | The strongest, most conservative number — the one worth publishing externally if AT24 ever markets this capability |

### 7.3 What NOT to measure as success

Message count, conversation count, and "AI engaged" are explicitly **not** success metrics — they may be reported as volume/load context, never as the number that drives a go/no-go or a roadmap decision. This is a direct, deliberate rejection of the anti-pattern the brief calls out and the research confirms is exactly what mature 2026 platforms have moved away from.

---

## 8. Build vs. buy / what AT24 owns

### 8.1 The question

*What should AT24 own as its intelligence/control plane, and what — if anything — should be delegated to an external support platform?*

### 8.2 Applying the researched decision framework to AT24's actual position

The build-vs-buy research converges on: **build when the agent platform is strategic IP, when proprietary workflow logic no vendor replicates, when an experienced team already ships production agent systems, and when compliance/architecture needs exceed any vendor's — buy for everything else, because buy is measured in days-to-weeks vs a custom build's 6–12 months.**

Checked against AT24's actual state:

| Framework criterion | AT24's actual position |
|---|---|
| Is the agent platform strategic IP? | **Yes.** The A1–A15 framework, K1–K4 knowledge loop, and the deterministic evidence/authorization model are the platform's own differentiator — the same infrastructure other AT24 agents (RESEARCH, MARKET_INTELLIGENCE, STRATEGY_RESEARCH) already run on. Buying a vendor platform for Support would mean running the *same problem* twice, on two different, non-interoperable governance models. |
| Does the workflow need proprietary logic no vendor replicates? | **Yes.** No researched vendor has AT24's specific domain (trading-platform licensing, credit ledgers, marketplace entitlements) pre-built; every vendor deployment starts with the same "connect your systems" integration work AT24 would face buying *or* building. |
| Does AT24 have an experienced team already shipping production agent systems? | **Yes.** CS1 + the three trading agents are live, production-verified, with real authorization/evidence/evaluation infrastructure — this is not a greenfield build, it is an extension of working infrastructure. |
| Do compliance/architecture requirements exceed vendor capability? | **Partially.** AT24's "no LLM invents account state, no autonomous financial action" rule (§5) is stricter than what several vendors' own marketing implies about their write-action defaults — a vendor platform would need to be configured *down* to AT24's bar, not up. |

**All four criteria point to build**, using AT24's own existing infrastructure — this is close to the clearest "build" case the framework describes, because the infrastructure is not hypothetical, it is already running.

### 8.3 The one narrow "buy" worth flagging (not a recommendation to act on now)

The research also surfaces a real hybrid pattern: *"many enterprises buy AI voice infrastructure but build proprietary orchestration layers internally."* If AT24 ever needs a **channel** it does not have today — voice, WhatsApp, SMS — the channel *transport* (telephony, message delivery, a chat-widget SDK's low-level rendering) is reasonable to buy or use an open-source component for, while the **reasoning/permission/knowledge core stays AT24-owned** and is merely *connected* to that channel. This is explicitly not proposed as work for this program (§13) — flagged because the "what to delegate" question deserves a real, if narrow, answer rather than an implied "buy nothing ever."

### 8.4 Locked recommendation

**AT24 owns the entire control plane** (gateway, intent/context, reasoning, tools, authorization, verification, resolution, escalation, learning) on its existing A1–A15/K1–K4 infrastructure. **No vendor platform is recommended for any part of the reasoning or permission layers.** A channel-transport buy is a legitimate future option, scoped separately, never as a substitute for the core.

---

## 9. AT24 phased roadmap

Derived from §2's capability gap and §4's tiers — each phase adds exactly one tier or one structural capability, never both at once, matching the platform's own "one concern per commit/sprint" discipline already used across CS1/K1–K4/AN.

| Phase | Adds | Depends on |
|---|---|---|
| **P0 — CS1 Foundation** | ✅ done | — |
| **P1 — Support Widget** | Root-mounted widget UI (§6) calling the *existing* CS1 backend, authenticated only at first (no new backend risk) | none new — pure UI wrapping the shipped agent |
| **P2 — Guest-safe Gateway** | Anonymous visitor support (§5.2 anonymous tier), the widget's public-page reach, a guest-safe agent-run path bound only to `support.knowledge_search` at `visibility:["public"]` | P1; a new, narrower authorization path (reuses A8 unchanged — a new, more restrictive `AgentDefinition`, not a new authorization mechanism) |
| **P3 — Intent/Context Upgrade** | A support-specific classifier (§2.2, pattern reused from K3-B/C, module not shared) + the 5-state resolution model (§3.3) replacing today's 3-value `coverage` | P1/P2; no dependency on K3-C's own module (separate implementation, same pattern) |
| **P4 — Account-aware Investigation (L2, richer)** | Multi-tool investigation plans (still deterministic, no LLM) — e.g. cross-referencing license status against a troubleshooting KB article in one turn | P3 |
| **P5 — Controlled Actions (L3)** | The first authorized write tools, individually permissioned, ceiling-bounded, state-reverified (§4 L3, §5.3 examples: license reactivation within policy) | P4; a genuinely new A8 permission set + new tools, same mechanism as trading permissions |
| **P6 — Human-in-the-Loop Actions (L4)** | Approval-gated consequential actions using the dormant `awaiting_approval` AF-v1 status | P5 |
| **P7 — Real Escalation + Learning** | The actual hand-off artifact (§2.2) — this is "CS2" from CS1.2 D9 — plus K4's candidate-capture loop, **contingent on K3-C closing first** (explicit owner gate, unrelated to this program's own pacing) | P3 (for the hand-off artifact) · K3-C closure (for K4/learning specifically) |
| **P8 — Proactive Support** | Event-triggered outreach (§6.6) | Automation program maturity (separate, currently mid-observation-window) |
| **P9 — High-Autonomy Support** | Reassess L3/L4 ceilings upward only after P5–P7 have real measured data (§7) proving the tiers below are safe and accurate — not a scheduled phase, a data-gated one | P5, P6, P7 all live with ≥1 full measurement period of data |

**Note on ordering:** P5 (controlled actions) is deliberately placed *before* P7's learning loop, not after — an action-capable agent with no learning loop is safer and more auditable (every action is still individually human-designed and ceiling-bounded) than a learning loop with no action capability would be useful. This mirrors the owner's own K3-C-before-K4 sequencing logic (harden the decision boundary before the system that promotes conversations into durable knowledge/actions) applied one level up.

---

## 10. Locked decisions

| ID | Decision | Status | Rationale |
|---|---|---|---|
| ASS-D1 | AT24 owns the full control plane; no vendor platform for reasoning/permission/knowledge | **LOCKED** | §8.4 |
| ASS-D2 | "Resolved" = the 5-state model in §3.3, not a binary flag | **LOCKED** (target definition; not yet implemented) | §3 |
| ASS-D3 | Six-tier L0–L5 human-dependency model, tier = property of the permission grant on a specific tool (A8 mechanism, not a new authority system) | **LOCKED** | §4 |
| ASS-D4 | Financial/billing changes and destructive actions are L4/L5 only, never autonomous, regardless of amount or phrasing | **LOCKED** | §5.3 |
| ASS-D5 | Trading/financial-advice questions are out of this program's domain entirely; route to existing governed trading agents or decline | **LOCKED** | §5.3 |
| ASS-D6 | Widget mounts at root layout (`app/layout.tsx`), not the dashboard shell — required for guest reach | **LOCKED** | §6.1 |
| ASS-D7 | Autonomous Resolution Rate is the primary metric; message/conversation counts are volume context only, never a success metric | **LOCKED** | §7 |
| ASS-D8 | Proactive assistance and attachments are out of scope for the roadmap in §9; not phased, not designed | **LOCKED** (deferred) | §6.4, §6.6 |
| ASS-D9 | P7 (real escalation + learning) is gated on K3-C closure for its learning-loop half; the hand-off-artifact half is not | **LOCKED** | §9 |
| ASS-D10 | This document authorizes NO implementation; P1 requires a separate implementation-authorization gate, same house pattern as CS1/K4.1 | **LOCKED** | §12 |
| ASS-D11 | A guest-safe agent path is a new, more restrictive `AgentDefinition` on the existing A8 authorization mechanism — never a second authorization system | **OPEN** — needs owner confirmation before P2 scoping | §9 P2 |
| ASS-D12 | Conversation-identity continuity across the anonymous→authenticated transition | **OPEN** — no existing AT24 primitive covers this; needs its own small design pass before P2 | §6.3 |
| ASS-D13 | Whether `/dashboard/support` (CS1's full-page console) is deprecated or kept as a widget "expand" affordance | **OPEN** — implementation-sprint decision, not an architecture decision | §6.2 |
| ASS-D14 | Exact L3 action list and per-action ceilings (e.g. reactivation limit numbers) | **OPEN** — product/policy decision, not an engineering one; needed before P5 | §5.3 |

---

## 11. Explicit non-goals (this document and near-term roadmap)

No new vector DB, reranker, or embedding model. No LLM in the resolution/escalation *decision* (only in synthesis, same as today). No autonomous financial action at any phase in §9. No voice/SMS/WhatsApp channel. No vendor platform purchase. No K4 implementation (blocked independently). No touching CS1's frozen `63d4eb1` code. No proactive/event-triggered support. No multi-agent "swarm" pattern — one Support specialist, richer plans, per the platform's own G04 lock.

---

## 12. What this document is and is not

This is an **R&D + architecture decision lock**, the same shape as CS1.1/CS1.2 and K4.1. It authorizes **zero implementation**. §9's phases are a roadmap, not a schedule — each phase (starting with P1) needs its own scoping pass and explicit authorization before any code is written, following the exact gate discipline already used for CS1 and K4.1: R&D → owner review → (only then) an implementation sprint with its own verification gate.

---

## 13. Change log

| Date | Entry |
|---|---|
| 2026-09-14 | Initial R&D pass. 8 deliverables + the build/own strategic question, researched against 5 industry platforms (Intercom Fin, Salesforce Agentforce, Zendesk, Ada, Sierra/Decagon) and independent 2026 agentic-AI-security research. Core finding: AT24's existing A1–A15/K1–K4 infrastructure already implements the two hardest layers (reasoning/permission separation) that the industry treats as its hardest problem — the gap is capability (tools, tiers, widget, measurement), not governance architecture. 14 decisions locked/opened (§10); a 10-phase roadmap (§9) derived from the capability gap, not assumed in advance. |

---

## 14. Sources

- [Intercom Fin AI Explained (2026)](https://www.getmacha.com/blog/intercom-fin-ai-explained)
- [Fin AI Agent explained — Intercom Help](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)
- [Intercom Fin AI Review: We Tested It on 500 Tickets (2026)](https://builts.ai/blog/intercom-fin-ai-review/)
- [4 Critical Features for Agentforce Architecture in 2026 — Salesforce Ben](https://www.salesforceben.com/4-critical-features-for-agentforce-architecture-in-2026/)
- [Salesforce Agentforce: Architecture, Pricing & MCP — Atlan](https://atlan.com/know/ai-agent/ai-agent-applications/what-is-salesforce-agentforce/)
- [Salesforce Agentforce Architecture — Cloudespacio](https://cloudespacio.com/salesforce-agentforce-architecture/)
- [Zendesk Unveils Autonomous AI Workforce at Relate 2026 — CMSWire](https://www.cmswire.com/customer-experience/zendesk-unveils-autonomous-ai-workforce-at-relate-2026/)
- [AI Agents for Customer Service — Zendesk](https://www.zendesk.com/service/ai/ai-agents/)
- [Zendesk Relate 2026: Agentic Service Starts With Knowledge — Forrester](https://www.forrester.com/blogs/zendesk-relate-2026-showed-why-agentic-customer-service-starts-with-knowledge/)
- [AI Customer Service Agents for Enterprise CX — Ada](https://www.ada.cx/)
- [Guide To Automated Resolution in AI Customer Service — Ada](https://www.ada.cx/resources/guide/what-is-automated-resolution-in-ai-customer-service/)
- [Sierra AI vs Decagon: AI Agent Platform Comparison (2026) — Quiq](https://quiq.com/blog/sierra-ai-vs-decagon/)
- [Sierra AI Platform: Architecture, Pricing, Context Gaps — Atlan](https://atlan.com/know/ai-agent/ai-agent-applications/what-is-sierra-ai/)
- [Decagon vs Sierra: The 2026 Guide — eesel AI](https://www.eesel.ai/blog/decagon-vs-sierra)
- [Autonomous resolution rate definition — Gladly](https://www.gladly.ai/glossary/autonomous-resolution-rate/)
- [What Resolution Rate Can AI Customer Support Achieve? (2026 Benchmarks) — Lorikeet](https://www.lorikeetcx.ai/articles/resolution-rate-ai-customer-support-benchmarks-2026)
- [What Is Autonomous Resolution Rate? — OnClarity](https://www.onclarity.com/glossary/autonomous-resolution-rate)
- [AI-to-Human Handoff: Best Practices for Support Escalation in 2026 — BlueTweak](https://www.bluetweak.com/blog/ai-to-human-handoff)
- [Chat UI Design: How to Build Effective Chat Interfaces in 2026 — UXPin](https://www.uxpin.com/studio/blog/chat-user-interface-design/)
- [AI Chatbot with Human Handoff: Guide (2026) — Social Intents](https://www.socialintents.com/blog/ai-chatbot-with-human-handoff/)
- [Agentic Guardrails for Customer Support — Chat Data](https://www.chat-data.com/blog/agentic-customer-support-guardrails-openclaw)
- [Guardrails Won't Always Stop Customer AI Agents. Is Your Enterprise Ready? — CX Today](https://www.cxtoday.com/security-privacy-compliance/customer-ai-agents-guardrails-enterprise-security/)
- [AI Agents Are Entering Your Customer Workflows. Do They Have the Right Authority? — CMSWire](https://www.cmswire.com/customer-experience/when-ai-agents-can-act-permission-rules-are-the-new-guardrails/)
- [Build vs. Buy AI Agents: A CIO Decision Framework — Streebo](https://www.streebo.com/build-vs-buy-ai-agents-enterprise/)
- [Build vs Buy AI Customer Service Agent (2026) — Fin](https://fin.ai/learn/build-vs-buy-ai-customer-service-agent)
- [Build vs. Buy in Enterprise AI: How to Make the Right Call — Maven AGI](https://www.mavenagi.com/resources/build-vs-buy-enterprise-ai)
