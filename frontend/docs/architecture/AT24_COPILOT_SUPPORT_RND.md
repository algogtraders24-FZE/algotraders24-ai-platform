# AT24 Copilot (Support) - R&D: closing the gap to Didit

Status: **R&D only. No code, schema or config was changed.** Owner review required before any implementation.
Date: 2026-10-15. Branch: `docs/at24-copilot-support-rnd`.
Builds on (does not replace): `SUPPORT_CHAT_MASTER_ARCHITECTURE.md`, `SUPPORT_HUMAN_HANDOFF_ARCHITECTURE_LOCK.md`, `AUTONOMOUS_SUPPORT_SYSTEM_RND.md`.

Evidence labels used throughout: **[measured]** = observed live on 2026-10-15, **[code]** = read from `origin/main`, **[inferred]** = deduced, not proven.

---

## 0. Summary and recommendation

1. **Naming.** Rename the support experience to **AT24 Copilot** (labels only). One real conflict: AT24 already ships a **Trading Copilot** (market analysis). Two products named "Copilot" will confuse users and support answers. Recommendation in section 1.
2. **We are slower and less helpful than Didit, and the biggest cause is not the AI.** A simple answer takes **16-26 s** [measured]; Didit shows words in ~3-6 s and finishes in ~10 s [measured, approximate]. The largest single cause is a **region mismatch: the database is in Tokyo, the Vercel functions run in Washington DC** [code + measured]. That is a configuration fix, not a rebuild.
3. **Our answers are raw knowledge-base passages**, not written answers, and follow-up questions ignore the previous turn when searching [measured]. Didit writes a grounded answer with sources and understands follow-ups [measured].
4. **A bug amplified by the Human Handoff MVP:** keyword matching (`upgrade`, `cancel`, `refund`, ...) creates a real ticket even when the knowledge base already answered correctly, and halts the AI [measured]. Didit's pattern, "draft the escalation and ask the user first", is the right fix.
5. **Proposed order:** (0) region + rename + measure, (1) ticket-on-confirm and admin identity, (2) one-request run with streamed progress, (3) composed answers with sources and follow-up rewriting, (4) history/resume, quick replies, feedback. Section 9.
6. **Eight owner decisions** are listed in section 10. The most consequential: relaxing locked invariant A so a strong KB match may also be *composed* into prose (still cited, still compliance-scanned).

---

## 1. Naming: "AT24 Copilot"

Scope of a rename is **labels only**. The agent type stays `SUPPORT`, routes stay `/dashboard/support`, and no schema or code identifier changes. User-visible strings to change [code]:

| Where | Today | Proposed |
|---|---|---|
| Floating widget button | "Support" (`SupportWidget.tsx:427`) | "Copilot" |
| Widget header | "Support" (`SupportWidget.tsx:440`) | "AT24 Copilot" + subtitle |
| Full page title | "Support Assistant" (`dashboard/support/page.tsx:66`) | "AT24 Copilot" |
| Submit button | "Ask Support" (`page.tsx:143`) | "Ask" |
| Sidebar | "Support" (`config/dashboard.config.ts:290`) | "AT24 Copilot" |
| KB articles I seeded | mention "Support Assistant" | re-seed with new name |
| Admin queue | "Support Tickets" | keep (it is staff-facing) |

**Conflict.** `Trading Copilot` appears in the sidebar/page (`app/dashboard/trading-copilot`), the platform page, header component and terms of service [code]. Options:

- **A (recommended):** support becomes **AT24 Copilot**; the existing analysis tool is relabelled **Market Copilot** (or "Trading Analysis") so the word "Copilot" means one thing. Cost: a handful of labels plus the terms-of-service line, no routes.
- **B:** mirror Didit exactly: public/logged-out = **AT24 Assistant**, logged-in = **AT24 Copilot**. Didit does this (public "Didit Assistant", in-console "Didit Copilot") [measured]. It also matches our existing guest/authenticated split.
- **C:** keep both "Copilot" names. Not recommended; support answers about "the Copilot" become ambiguous.

---

## 2. What Didit actually does (observed live, 2026-10-15)

Two surfaces, same widget shell.

| Capability | Didit Assistant (public site) | Didit Copilot (inside the console) |
|---|---|---|
| Knowledge | "Answers from the Didit Help Center" [measured] | Knows the console and the user's real configuration |
| Answer style | Composed prose with a bullet price list and a closing summary [measured] | Same, plus account-specific facts |
| Sources | "SOURCES" list with titles and links under each answer [measured] | Same |
| Follow-ups | "and what about KYB for businesses?" was understood from the previous turn [measured] | Same |
| Quick replies | Four chips on open: KYC pricing, Integrate the SDK, API docs, Supported countries [measured] | Slash "skills" (`type / for skills`) [measured] |
| Feedback | thumbs up / down under each answer [measured] | Same |
| Input | text, attach file, microphone, send [measured] | Same |
| Conversation | New chat (+), History (clock), menu, close [measured] | Same; previous chats persist [measured] |
| Actions | none | Reads live state (workflow table with ON/OFF and warnings), navigates pages and dialogs, can change settings when asked [measured, from an earlier chat in the console] |
| Honesty | Footer: "can make mistakes... email hello@didit.me" [measured] | Said "that setting is not here, I can't flip it", then "I have not changed anything - this page was read-only navigation", then offered to "draft the escalation to you first" [measured] |
| Language | n/a | Answered in the user's Hinglish [measured] |
| Human handoff | Email address in the footer | Escalation drafted, shown to the user, then sent [measured] |

Backend hints [inferred from network URLs]: conversation/message APIs on a `chat.didit.me` inbox (Chatwoot-style contacts, conversations, messages) plus an `assistant.didit.me/support/turn-context` call per turn. The inference is that Didit keeps one conversation record that both the bot and humans write to.

**Speed, Didit** [measured, approximate]: message-send request returns in 0.15-0.4 s; a "Thinking..." indicator appears immediately; text starts streaming at roughly 3-6 s; a multi-paragraph answer is complete in about 10 s. Exact time-to-first-token could not be read because the widget content is not visible to page scripts; figures come from request timings and spaced screenshots.

---

## 3. AT24 today (measured on production, 2026-10-15, logged in)

| Test | Result |
|---|---|
| "What is Live Sync?" end to end | **19 s**: create run 2.3 s, read run 2.0 s, advance 3.5 s, 6.9 s, 4.2 s |
| 5 further KB questions | 16-26 s each (17, 17, 16, 25, 26) |
| "hi" (generated greeting) | 21 s, correct, no ticket |
| Question containing "upgrade" | ~35 s, answered **and** created a ticket, UI switched to human-only |
| Trivial public route (`/api/support/session`) | 0.66-0.67 s |
| Authenticated DB route (`/api/private/support/handoff`) | 1.0-1.1 s |
| Response headers | `x-vercel-id: cdg1::iad1::...` (edge Paris, **function in Washington DC**) |
| Answer content | kb-answered returns raw KB passages; account findings (4 lines) attached to any question containing "plan"/"licence" |
| Follow-up "and what about the Pro plan?" | cited "Free plan" and "Change plan" articles; previous turn not used |
| Admin queue and case | internal user id only, no name or email |

Retrieval itself is correct: 7 of 7 new-feature questions returned the right article.

---

## 4. Why we are slow (ranked, with evidence)

1. **Region mismatch [code + measured].** `DATABASE_URL` points at `aws-0-ap-northeast-1.pooler.supabase.com` (Tokyo). `vercel.json` has no `regions` and no route sets `preferredRegion`, so functions run in the default **iad1 (Washington DC)**. Every query crosses the Pacific (roughly 150-200 ms round trip). The authenticated route costs ~0.35 s more than a no-DB route, consistent with two queries at ~170 ms. A support turn performs many sequential queries (session, run, steps, evidence, retrieval, handoff), so the cost multiplies. This is a **hypothesis with strong circumstantial evidence**; Phase 0 proves it with a before/after benchmark.
   **Feasibility proven [measured, 2026-10-15]:** an experiment branch whose only change was `"regions": ["hnd1"]` in `vercel.json` built and deployed successfully on the project, so the plan accepts a function-region setting. `vercel.json` already contains `*/2` and `*/5` minute crons, which the Hobby plan rejects (see `project_vercel_deployment_topology` memory), so the project is very likely **no longer on Hobby** and the old note is stale. The experiment was deleted afterwards. The speed gain itself could not be measured on that preview (it sits behind Vercel Authentication), so the gain is verified in Phase 0 on production, with a one-line revert if it does not help. Production guest-endpoint baseline before any change: ~1.3 s per question.
2. **Client-driven stepping [code].** The browser makes 5-6 sequential HTTP calls per answer (create, read, advance x3, then a handoff check). Each call pays its own auth and DB round trips. Didit sends one request.
3. **No streaming [code].** The user sees only a spinner until the whole run ends. Even the main AI Assistant does not stream tokens: its route emits the finished answer as one event and says "True Claude token streaming is K8" (`app/api/private/knowledge/chat/route.ts`). `lib/ai/providers/claude.provider.ts` is a plain REST call without streaming; the `claudeProvider` in `services/ai/providers/` is a not-implemented stub.
4. **Side effects in the request path [inferred].** The 35 s case also created a ticket and sends two emails; if awaited inline they add to latency. To be confirmed in Phase 0.
5. **Per-turn model work.** The generative fallback is a separate non-streaming completion (Phase A). Acceptable once 1-3 are fixed.

---

## 5. Gap analysis

| Didit capability | AT24 status | Effort | Notes |
|---|---|---|---|
| Fast first feedback | spinner for 16-26 s | S | Region fix, then streamed stage events |
| Streaming text | none anywhere | M | New SSE path; Claude REST supports `stream: true`, no SDK needed |
| Composed answer with sources | raw passages | M | Needs invariant A relaxed (decision D3) |
| Follow-up understanding | previous turn ignored for retrieval | S-M | Rewrite follow-up into a standalone query using the Phase B window |
| Ask before escalating | ticket auto-created on keywords | S | Marker fix + confirm step (decision D2) |
| Quick-reply chips | none | S | Static, per surface |
| Feedback (thumbs) | none | S | Store on the run |
| Conversation history | lost on reload | M | Server list by user; `?conversation=` resume (we already have `?handoff=`) |
| In-product actions | none (read-only by design) | L, **out of scope** | See non-goals |
| Mirror user language | partly (generation prompt) | S | Add to system instruction |
| Staff sees who the user is | internal id only | S | Show email and name in queue and case |

---

## 6. Target: AT24 Copilot

Principles, all inherited from locked decisions and kept: read-only, evidence-first, honest coverage, safe failure to a human, no financial advice, guests never reach account data.

**Surfaces.** Same two as today, same widget shell: logged-out (public KB only, per-IP limit) and logged-in (public + customer KB, read-only account status, tickets). Decision D1 chooses whether they carry two names.

**Experience.**
1. Open: greeting plus 4 quick-reply chips (for example "Plans and credits", "Live Sync", "My license key", "Talk to a person").
2. Send: instant "Thinking..." and a stage line ("Searching the knowledge base...").
3. Answer streams in as prose, ends with **Sources** (existing citation evidence), thumbs up/down, and a "Did this solve it?" confirmation (already built in P1).
4. Follow-ups work without restating context.
5. When a human is genuinely needed, Copilot shows a **drafted summary** of the request and asks "Send this to our team?" Only on yes does it create the ticket.
6. History button lists previous conversations; reload resumes the latest.

---

## 7. Design options per workstream

### W1 Speed
- **1a Region (recommended first).** Run API functions in the database's region (Tokyo, `hnd1`) via the Vercel project's Function Region (or `vercel.json` `regions`). Plan note: the project is on Hobby; confirm Hobby allows choosing a single region before relying on it. Alternative: move the database near the functions (rejected: shared production data, migration risk).
- **1b One request.** A single endpoint runs the whole run server-side and returns progress as newline-delimited JSON (the pattern the knowledge chat route already uses), replacing the create/read/advance loop. Keeps the A1-A15 runtime and `AgentRun` records; only the driver moves from browser to server.
- **1c Token streaming.** Add `stream: true` handling to the REST Claude provider and forward tokens. Compliance scan runs on the completed text before final commit; if it fails, replace the streamed text with the safe fallback (design detail for implementation scoping).
- **1d Defer side effects.** Ticket emails and ops alert run after the response (Vercel `waitUntil` or equivalent).
- Targets (to be validated by Phase 0 measurements, not promised): time to first visible feedback under 1 s; first streamed words under 3 s; full answer p50 under 8 s, p95 under 15 s.

### W2 Answer quality
- **2a Compose from retrieved chunks.** After retrieval, ask Claude to write a short grounded answer from the cited chunks only, with the chunks kept as Sources. Reuse Phase A machinery (provider chain, `scanForForbiddenLanguage`, `AgentEvidence`, credit ledger). Needs invariant A relaxed (D3): today a strong match is always the citation path and generation only runs on `no-coverage`.
- **2b Keep guests raw by default.** Guest generation was deferred (GA-D10) because anonymous traffic would carry model cost. Option: guests get composed answers behind a tighter rate limit, decided separately (D4).
- **2c Account context only when asked.** Attach account findings only for questions that are actually about the account, not for any sentence containing "plan" (narrow `ACCOUNT_MARKERS`), and never into the generation input (invariant B).

### W3 Follow-ups
Rewrite a short follow-up into a standalone query using the last N turns (Phase B already carries a bounded window for generation) **before** retrieval. One small model call or a deterministic template for short pronoun-style follow-ups. Retrieval remains the evidence source.

### W4 Handoff
- Stop auto-creating tickets from `MUTATION_MARKERS` alone. Auto-create only when the question is **unresolved** (`no-coverage`) or the user confirms; mutation-intent questions that the KB answered get the answer plus a "Connect me to the team" offer.
- Draft-then-confirm step (Didit pattern). The draft is built from data we already hold (question, citations, coverage).
- Show requester email and name in the admin queue and case.
- Needs a decision because the Handoff Architecture Lock D3 treated `escalate:true` as the sole trigger authority (D2).

### W5 History and resume
Phase B already links turns by `conversationId`. Add `GET /api/private/support/conversations` (own conversations only) and a history drawer; page loads the latest by default or `?conversation=<id>`. No new realtime infrastructure; optional idle polling stays a separate item.

### W6 Polish
Quick-reply chips, thumbs feedback stored against the run (feeds the Phase E operations view), language mirroring in the system instruction.

---

## 8. Safety and invariants

Locked and unchanged: B account-data isolation, C mutation isolation (nothing here lets the model change an account), D no knowledge-loop coupling, E one support engine, G safe failure, plus the handoff invariants (one active ticket per conversation, ownership scoping, audit trail).
Proposed change: **A (evidence-first)**, to allow composed prose for strong matches while keeping every statement tied to cited chunks and the compliance scan.
Unchanged non-goal: Didit's Copilot can change settings. **AT24 Copilot stays read-only.** A later "guided action with confirmation" program (L3) would be its own R&D.

---

## 9. Phased roadmap

Each phase ends with its own measurement, closure verification and owner gate, as in prior programs.

| Phase | Content | Acceptance |
|---|---|---|
| **0** (hours) | Benchmark script (end-to-end and per-step timing). Region change. Remove the redundant read between create and advance. Rename labels (decision D1). Re-seed KB wording. | Before/after numbers recorded; p50 end-to-end measurably lower; no behaviour change otherwise |
| **1** | Ticket only when unresolved or confirmed; draft-then-confirm; narrow markers; requester identity in admin; close the stale 2026-09-20 test ticket | Questions containing upgrade/cancel/refund that the KB answers create **no** ticket; handoff validators updated and green |
| **2** | One-request run with NDJSON progress; deferred emails; token streaming | First feedback under 1 s; first words under 3 s on production |
| **3** | Composed answers with Sources; follow-up rewriting; narrower account attachment | Follow-up test set passes; every sentence traceable to a cited chunk; compliance scan on all outputs |
| **4** | History list and resume; quick-reply chips; thumbs feedback; language mirroring | Reload resumes; feedback stored; chips per surface |

Phase 0 and 1 are independent of the open design decisions apart from D1 and D2, and should land first because they remove the two visible defects (slowness, wrong tickets).

**Execution note (2026-10-15):** the owner instructed "do whatever is needed to build the best system", so Phases 0 and 1 proceed immediately as separate small PRs (region + labels + redundant read; ticket policy + requester identity). Phases 2-4 and decisions D3, D4, D6, D7 remain gated on review of this document. For D1 the support rename is applied; the Trading Copilot relabel is deliberately **not** done without an explicit owner call.

---

## 10. Owner decisions required

| # | Decision | Recommendation |
|---|---|---|
| D1 | Name and collision: option A, B or C in section 1 | B (Assistant logged-out, Copilot logged-in), and rename Trading Copilot to Market Copilot |
| D2 | Change handoff trigger: no auto-ticket on keywords; confirm before creating | Yes |
| D3 | Relax invariant A: compose prose for strong KB matches (cited, scanned) | Yes, logged-in first |
| D4 | Guests: raw passages only, or composed answers under a tighter limit | Raw for now; revisit after cost data |
| D5 | Vercel function region change; confirm plan allows it | Yes, Tokyo |
| D6 | Token streaming: accept a mid-stream compliance replacement behaviour | Yes |
| D7 | Retain thumbs feedback and conversation history (data retention scope) | Yes, own-user only |
| D8 | Keep AT24 Copilot read-only (no in-product actions) | Yes |

---

## 11. Risks and non-goals

- Region move changes latency for every function, not only support; measure the whole site afterwards. Edge location stays global.
- Composed answers add model cost per turn; credit accounting follows the existing Phase A pattern (GA-D7).
- Streaming plus a compliance scan can show text that is later replaced; mitigated by scanning sentences as they complete or scanning before reveal.
- Non-goals: in-product actions, voice input, file attachments, Didit's multi-vendor inbox, any change to Support Chat's guest/account boundary, any realtime infrastructure.

---

## 12. Evidence appendix

Measured 2026-10-15 from the owner's logged-in Chrome (production, `www.algotraders24.ai`) and Didit's public site and console:
- AT24 run timings: create 2.3 s, read 2.0 s, advance 3.5 / 6.9 / 4.2 s (19 s total); five other questions 16-26 s; ticket-creating question ~35 s.
- Baseline requests: public route 0.66 s, authenticated route 1.0-1.1 s, `x-vercel-id` shows the function in `iad1`.
- Didit: send request 0.15-0.4 s; stages and answer observed via spaced screenshots.
- Production ticket created by the test was cancelled; one older test ticket (2026-09-20, IN_PROGRESS) remains.

Code references (all `origin/main`): `frontend/vercel.json` (no regions), `frontend/.env` DB host region (Tokyo pooler), `frontend/services/agent-framework/supervisor/specialists/support.specialist.ts` (markers and escalate decision), `frontend/services/agent-framework/api/agent-run-service.ts` (`advanceAgentRun`), `frontend/hooks/useSupportRun.ts` (client loop), `frontend/lib/ai/providers/claude.provider.ts` (REST, non-streaming), `frontend/app/api/private/knowledge/chat/route.ts` (NDJSON pattern, "token streaming is K8"), `frontend/components/support/SupportWidget.tsx` and `frontend/app/dashboard/support/page.tsx` (labels).

Known limits of this R&D: Didit internals are inferred from URLs and behaviour, not documentation; first-token timing for Didit is approximate; the Vercel region hypothesis is strong but unproven until Phase 0 measures it.
