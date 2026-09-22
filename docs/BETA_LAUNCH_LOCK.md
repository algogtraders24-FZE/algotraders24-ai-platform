# AT24 Beta Launch Lock — Decision Record

**Status:** LOCKED
**Decision:** BETA GO 🟢
**Decided by:** Product owner (algogtraders24@gmail.com), 2026-09-13
**Effective:** immediately

> **AT24 Beta is approved for launch.** K3-C, K4, P4.9-B.5 and Automation
> Migration B are explicitly **non-gating** and remain separate post-Beta
> tracks. This record is the single source of truth for that boundary —
> it exists so the team stops re-litigating "one more subsystem before
> launch" and instead drives further hardening from production evidence.

---

## 1. What this record is

A Beta launch decision is a judgment call about which **acceptance
criteria** must be satisfied before shipping — not a claim that every
initiative in flight has finished. This record freezes that boundary once,
in writing, so it isn't re-opened by default the next time a hardening or
governance track is still in progress.

Any change to the GO/NO-GO call, or to which tracks are gating vs.
non-gating, requires a new dated entry in §5 below — not a silent
assumption in a later sprint.

## 2. Beta gate decision matrix

| Area | Decision |
| --- | --- |
| Homepage | 🟢 GO |
| Authentication | 🟢 GO |
| AI Assistant | 🟢 GO |
| Knowledge Base | 🟢 GO |
| Market Intelligence | 🟢 GO — disclosed provider limitation (§3.1) |
| Billing | 🟢 GO — disclosed external-provider limitation (§3.2) |
| Admin | 🟢 GO |
| Algo Testing (P3.x / P4.x) | 🟢 GO |
| Marketplace | 🟢 GO |
| Publishing | 🟢 GO |
| Knowledge Loop (K0–K3-A/B) | 🟢 GO |
| K3 Orchestration | 🟢 GO |
| Chat Support (CS1) | 🟢 GO |
| Automation MVP | 🟢 GO |
| P4.9-B.5 (WFO follow-on) | ⏸️ Deferred / non-gating |
| Automation Migration B | ⏸️ Deferred / non-gating |
| **K3-C Orchestration Hardening** | ⏸️ Post-Beta hardening — non-gating |
| **K4 Knowledge Governance** | ⏸️ Post-Beta governance — non-gating |

**Overall: BETA GO 🟢**

## 3. Launch notes (disclosed limitations, not gaps hidden from the call)

### 3.1 Market Intelligence
EURUSD is live end-to-end. XAUUSD (Gold) and XAGUSD (Silver) are also live
end-to-end via the MT5 bridge, which is now the primary provider for the
symbols it covers (XAUUSD/XAGUSD/EURUSD/GBPUSD/USDJPY/BTCUSD/ETHUSD).
Twelve Data and Alpha Vantage remain configured as fallback providers
where applicable. See §5 for the amendment superseding the prior
Gold/Silver provider-coverage limitation.

### 3.2 Billing
The real subscription lifecycle (Plan/Subscription/Entitlement, feature
gating, usage metering) is live. Stripe Checkout and NOWPayments crypto
invoicing are implemented and gated by `isConfigured()`, verified via local
cryptographic webhook-signature tests — but end-to-end verification against
**live** provider API keys has not been done, because no live keys exist in
this environment. Verify live before the first real payment is taken.

### 3.3 K3-C / K4 are hardening and governance, not unfinished Beta features
K3-A/B orchestration is already live in production (merge `9c08879`,
Vercel deploy confirmed, 28/28 live smoke). K3-C is hardening *on top of*
that live layer (Claude server-tool lifecycle edge cases, fallback-signal
completeness, injection-hardening) — not a repair of something broken in
the Beta surface. K4 is a knowledge-governance track with a decision
record merged but **no implementation started**. Neither blocks Beta.

## 4. Rule for non-gating tracks that continue in parallel

> K3-C, K4, and any other post-Beta track **may continue in parallel with
> Beta**, but they are held to the same regression/deployment discipline as
> everything else: if a change touches a shared production path (the
> Agent Framework, Knowledge Loop, credit ledger, auth/session, etc.), its
> normal regression suite and deployment gate still apply before it merges.
> "Non-gating for Beta" is not a license to skip verification — it only
> means Beta launch does not wait on that track's own completion.

Deferred/parked items stay exactly as previously decided:
- **P4.9-B.5**: deferred pending a separate planning/reconnaissance gate
  (owner's own prior call, [[project_p49_optimization_program]]).
- **Automation Migration B**: the legacy 14D `Automation` + 14E
  `workflows`/`workflow_runs`/`workflow_queue_items` tables stay as an
  intentionally-retained compatibility/rollback surface. SQL sits ready,
  untouched, in `frontend/prisma/deferred/MIGRATION_B_*.sql`. Its gate:
  observation clean → dependency audit confirms zero runtime references →
  explicit authorization → migration → post-migration smoke.

## 5. Amendment log

| Date | Change | By |
| --- | --- | --- |
| 2026-09-13 | Initial lock: BETA GO, K3-C/K4/P4.9-B.5/Migration B non-gating | Product owner |
| 2026-09-22 | Corrected §3.1: Gold/Silver now live via MT5 bridge, superseding the 2026-09-13 provider-coverage limitation. | Product owner |
