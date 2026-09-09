# K3C_ACCEPTANCE — Orchestration Hardening & Production Quality Gate

**Sprint:** K3-C — AT24 AI Assistant Knowledge Loop, orchestration-hardening layer
**Branch:** `feat/k3c-orchestration-hardening` (base `origin/main` @ `6253165` — `K3C_DECISION.md` merged)
**Decision:** [`K3C_DECISION.md`](K3C_DECISION.md) (D-K3C-1..10, owner-approved 2026-09-10)
**Contract:** [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) §12 (K3-C hardening contracts, LOCKED)
**Status:** 🚧 IN PROGRESS — decision merged; contract amendments landed; implementation underway. **No migration. No `ANTHROPIC_API_KEY` in any file/log/commit. No `KnowledgeCandidate`.**

> K3-C closes the K3-B decision boundaries as testable contracts and hardens
> the server-tool + fallback + provenance failure paths. It adds **no
> capability** — reliability and contract closure only. K4 does not start
> until this gate closes.

---

## 0. Headline

```
K3-C STATUS:               IN PROGRESS
Decision (feat/k3c-decision): MERGED  → main 6253165
Contract §12 (LOCKED):     LANDED  (classifier precedence · decision matrix · fallback matrix ·
                                   webSearchFailed⟂webSearchRequestedButUnavailable · server-tool
                                   lifecycle · provenance-integrity+telemetry · injection clause ·
                                   ADR-K3C-1 / ADR-K3C-2)
C1 server-tool hardening:  ...
C2 classifier:             ...
C3 decision matrix:        ...
C4 provenance integrity:   ...
C5 fallback contract:      ...
C6 route/envelope:         ...
C7 adversarial + injection:...
C8 observability:          ...
C9 no new architecture:    ...
Offline suite:             ...
Live production smoke:     ...
MIGRATION:                 NONE
MERGE:                     BLOCKED on owner review of this document
```

---

## 1. Build order (D-K3C-10 — owner-locked)

`contract → tests → implementation → live verification`. Hardening before any
refactor. Every §12 contract row is pinned by an offline assertion.

| Step | Commit | State |
|---|---|---|
| Contract §12 amendments + this skeleton | (this commit) | ✅ |
| C1 — `ClaudeProvider` server-tool lifecycle + fixtures | | ⏳ |
| C2 — classifier precedence + `historical` + borderline + tests | | ⏳ |
| C5 — orchestrator: two-field split · DYNAMIC guard · continuation fall-through · `SKIPPED` sentinel · telemetry `meta` | | ⏳ |
| C7 — knowledge-block injection hardening + `validate-knowledge-loop-adversarial` | | ⏳ |
| C3 / C6 — `validate-knowledge-loop-{decision-matrix,route-contract,provenance-integrity}` | | ⏳ |
| C8 — structured telemetry emit + no-raw-content test | | ⏳ |
| Live production smoke + this doc filled | | ⏳ |

---

## 2. Hard boundary — what K3-C does NOT touch

(to be confirmed against `git diff origin/main` at close)

- No `prisma/schema.prisma` change · no migration · no new table
- No `KnowledgeCandidate` / candidate embedding / autonomous learning (K4)
- No `services/intelligence/**` / `AIPresenterOrchestratorService` / market-intel path
- No `services/ai/assistant.service.ts` redesign
- No Support Agent / Automation / UI / credit-billing
- No new AI/search/cache/vector dependency
- `sourceClass` enum **not** renamed (ADR-K3C-1)
- `at24-quant-engine RUNTIME_VERSION` tsc baseline untouched (P4.9)

---

## 3. C1–C9 evidence

_(filled per step)_

---

## 4. Offline test summary

_(filled at close)_

---

## 5. Live production smoke

_(filled at close — merged-main tree, real Claude web search + real Supabase provenance, mandatory cleanup, zero residue)_

---

## 6. GO / NO-GO

_(filled at close)_

---

## 7. Change log

| Date | Entry |
|---|---|
| 2026-09-10 | K3-C implementation started on `feat/k3c-orchestration-hardening` off `6253165`. Contract §12 (K3-C hardening contracts) landed: classifier precedence + `historical` intent, decision matrix + borderline-sufficient + DYNAMIC live-figures guard, fallback matrix, **`webSearchFailed` ⟂ `webSearchRequestedButUnavailable`**, server-tool lifecycle, provenance-integrity + telemetry, injection clause, ADR-K3C-1/2. |
