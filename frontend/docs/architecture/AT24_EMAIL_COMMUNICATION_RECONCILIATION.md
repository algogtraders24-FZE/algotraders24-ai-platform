# AT24 Email & Communication Reconciliation

**Status:** DISCOVERY ONLY. No application code, schema, or config was changed to produce this document.
**Author:** Claude Sonnet 5 (agent session), commissioned by the account owner.
**Date:** 2026-09-19.
**Scope:** Full-repo trace of every real or candidate transactional/notification email path in the AT24 platform (`E:\pay4cwork\frontend`), reconciled against the account owner's Beta email brief.

---

## 1. Executive Summary

The platform has exactly **one** working, production-wired transactional email: purchase confirmation, sent via Resend from `services/notifications/EmailService.ts` and triggered from the Stripe webhook's `marketplace_purchase` branch. Everything else the owner's brief asks about — welcome emails, password-changed emails, subscription lifecycle emails, refund emails, support-ticket emails, security-alert emails, marketing emails — is **not built**, and for several of them the underlying *event itself* isn't tracked anywhere yet, so there is nothing today to trigger an email from even if a template existed.

The good news: several domains already have exactly the kind of deterministic, idempotent event data a real notification system needs — Automation runs, Agent runs, License state transitions, and (partially) usage/credit thresholds — they're just not connected to anything that emails a human. Auth has real Supabase-hosted emails for verification/reset/resend already (not custom-built, but functioning). Billing/subscription has zero email coverage despite having clean state-transition functions to hang a notification off. Support has no ticket object at all — escalation today means "the AI declined to answer," a terminal state with no human-actionable identity, confirmed directly in code comments (`services/agent-framework/agents/support-agent.ts:22-23`: *"D5 Unresolved -> a structured escalate:true hand-off. No ticket is created in this slice (CS2)."*). Security event tracking is essentially absent: no IP, no device, no session metadata is captured anywhere.

No duplicate/competing notification system was found. `services/notifications/EmailService.ts` (email) and `services/analytics/AnalyticsEventService.ts` (internal analytics, explicitly not notification) do not overlap in purpose or trigger paths.

The `Purchase.status` field's `REFUNDED`/`REVERSED` values (`prisma/schema.prisma:1229`) are a comment-documented placeholder on an untyped `String` column — no code anywhere transitions a `Purchase` into either state. Per the owner's explicit instruction, this is **not** evidence of an active or planned refund flow and no refund work is proposed here.

---

## 2. Repository / Production Baseline

- Branch this report was authored from: `docs/email-communication-reconciliation`, branched off `origin/main`.
- `origin/main` HEAD at fetch time: `50cf1e8` — "Merge pull request #90 from algogtraders24-FZE/feat/purchase-confirmation-email" (the same commit that shipped the EmailService/Resend work described as pre-existing in this brief).
- Working tree state before this report's own commit: **clean** (`git status` reported "nothing to commit, working tree clean" on the source worktree branch `worktree-agent-ad3f3e61dcb720cf4`).
- This report's own change is additive-only: one new markdown file. See Section 20 for the diff-stat proof.

---

## 3. Existing Email Infrastructure

**File:** `services/notifications/EmailService.ts`

- Wraps the `resend` npm SDK. `getClient()` returns `null` (and the caller logs + no-ops) if `RESEND_API_KEY` is unset — fails safe, never throws into a webhook handler.
- Exports exactly one function: `sendPurchaseConfirmationEmail(params: { to, buyerName, productName, amount, currency, licenseId })`.
- Sends from `Algotraders24 AI <billing@algotraders24.ai>` — a real, monitored mailbox by design (code comment explicitly contrasts this with a `no-reply@` address).
- Template is inline HTML in the same file (no separate template engine, no template store, no i18n).
- No retry, no delivery-status logging, no queue — one `await client.emails.send(...)` per call, wrapped by the caller in try/catch.

**Only caller:** `app/api/webhooks/stripe/route.ts`, inside the `checkout.session.completed` handler's `session.metadata?.type === "marketplace_purchase"` branch (lines 69-112). Fires only when `!result.duplicate` from `issueLicenseForPurchase`, after resolving the buyer (`prisma.user.findUnique`) and listing title (`prisma.marketplaceListing.findUnique`). The email call is inside its own try/catch (lines 91-108) so a Resend failure never turns an already-completed purchase into a Stripe-retried 500.

This is confirmed live/wired infrastructure, not dead code — it sits on the only code path that actually creates a `License` row from a real payment.

---

## 4. Existing Notification-Adjacent Infrastructure

**File:** `services/analytics/AnalyticsEventService.ts`

- Backed by an append-only `AnalyticsEvent` Prisma model. `record(userId, type, metadata)` is the only write path; no update/delete.
- `AnalyticsEventType` union today: `"login" | "email_verified" | "ai_chat" | "knowledge_upload" | "market_analysis" | "subscription_click" | "product_view"`.
- Real callers: `app/(auth)/actions/auth.actions.ts:78` (`login` on password sign-in), `app/auth/callback/route.ts:38-41` (`login` + `email_verified` on the OAuth/confirmation callback, with a documented false→true guard so re-logins don't refire `email_verified`).
- This is explicitly an **internal beta analytics** system (its own header comment says so), not a notification/dispatch system — it never sends anything to a user. It is the closest thing to a "real event stream" in the app and is the most promising base to extend for security-event and credit-threshold detection (see Sections 11, 6), but it is not itself infrastructure for emailing anyone.

No other notification/dispatch abstraction exists (no queue, no template registry, no provider-agnostic notification service). `EmailService.ts` and `AnalyticsEventService.ts` are the entire footprint.

---

## 5. Auth Mapping (A01–A07)

| ID | Event | Status | Evidence |
|---|---|---|---|
| A01 | Email verification (signup confirmation) | **EXISTS** (Supabase-hosted, not custom) | `AuthService.signUp` (`services/auth/AuthService.ts:13-45`) calls `supabase.auth.signUp` with explicit `emailRedirectTo` pointing at `/auth/callback`. Supabase sends the actual email; the app only sets the redirect target. |
| A02 | Welcome email (post-verification) | **MISSING** | `app/auth/callback/route.ts` records `login`/`email_verified` analytics events (lines 38-41) on the real false→true transition, but nothing sends any email there. Deterministic trigger point already exists (the `!wasVerified && sessionUser.profile.emailVerified` branch) — no template, no dispatch. |
| A03 | Password reset request | **EXISTS** (Supabase-hosted) | `AuthService.forgotPassword` (`services/auth/AuthService.ts:105-118`) calls `supabase.auth.resetPasswordForEmail` with `redirectTo` → `/auth/callback?redirectTo=/reset-password`. Server action: `forgotPasswordAction` (`app/(auth)/actions/auth.actions.ts:92-110`). |
| A04 | Password changed confirmation | **MISSING** | `AuthService.updatePassword` (`services/auth/AuthService.ts:123-132`) completes the reset via `supabase.auth.updateUser({ password })`. No confirmation email of any kind (Supabase or custom) fires after this succeeds. |
| A05 | Email changed | **NOT APPLICABLE (no feature)** | No code path calls `supabase.auth.updateUser({ email })` or any equivalent anywhere in `app`/`services`. There is no "change my email" feature in the product today. |
| A06 | Email-change verification | **NOT APPLICABLE** | Depends on A05, which doesn't exist. |
| A07 | Account deletion confirmation | **NOT APPLICABLE (no feature)** | No `deleteUser`/account-deletion action found anywhere in `app`/`services`. The only place "delete my account" appears in the codebase is as a natural-language pattern the Support Agent's intent-detector matches to *escalate* (`services/agent-framework/supervisor/specialists/support.specialist.ts:44`), not an implemented deletion flow. |
| — | Resend verification (already-registered, not-yet-verified) | **EXISTS** (Supabase-hosted) | `AuthService.resendVerificationEmail` (`services/auth/AuthService.ts:50-67`), server action `resendVerificationAction` (`app/(auth)/actions/auth.actions.ts:116-131`), UI `components/auth/ResendVerificationButton.tsx`. |

---

## 6. Billing/Payment Mapping (B01–B08)

Traced through `services/billing/SubscriptionActionService.ts`, `services/billing/providers/StripeProvider.ts`, `services/billing/providers/NowPaymentsProvider.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/nowpayments/route.ts`.

| ID | Event | Status | Evidence |
|---|---|---|---|
| B01 | Payment success (subscription checkout) | **PARTIAL — event exists, no email** | `checkout.session.completed` handler, non-`marketplace_purchase` branch (`app/api/webhooks/stripe/route.ts:114-127`) calls `subscriptionActionService.activateFromPayment(...)`. Deterministic, idempotent-by-Stripe-event trigger point; zero email code anywhere in this branch or in `activateFromPayment` (`SubscriptionActionService.ts:116-152`). |
| B02 | Subscription started | **PARTIAL — same as B01** | Same `activateFromPayment` call handles first activation and renewal identically; no distinguishing "first time" signal is recorded, so even a future email would need new logic to tell "started" from "renewed." |
| B03 | Subscription upgraded | **PARTIAL — event exists, no email** | `SubscriptionActionService.changePlan(userId, targetPlanId)` (`SubscriptionActionService.ts:70-115`) is the real state-transition function called from the plan-change UI/route (not from a webhook). No email call inside it. |
| B04 | Subscription downgraded | **PARTIAL — same function as B03** | `changePlan` handles both directions; no upgrade/downgrade distinction is surfaced to any notification path. |
| B05 | Renewal reminder (pre-charge) | **MISSING EVENT SOURCE** | Nothing computes "N days until next charge" anywhere. `Subscription.currentPeriodEnd` exists as data but no cron/job reads it for a reminder purpose. |
| B06 | Payment failed | **MISSING EVENT SOURCE** | Neither webhook handler subscribes to `invoice.payment_failed` (Stripe) or a NOWPayments failure/expired status. `app/api/webhooks/stripe/route.ts`'s `switch` only handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` — a `default` case is a deliberate documented no-op (lines 152-155). |
| B07 | Subscription cancelled (user-initiated) | **PARTIAL — event exists, no email** | `SubscriptionActionService.setCancelAtPeriodEnd(userId, true)` (`SubscriptionActionService.ts:57-69`) is the real trigger; no email. |
| B08 | Subscription expired/cancelled (provider-initiated) | **PARTIAL — event exists, no email** | `customer.subscription.deleted` → `subscriptionActionService.markCanceledByProvider(sub.id)` (`app/api/webhooks/stripe/route.ts:147-151`, `SubscriptionActionService.ts:153-161`). Real, webhook-driven, idempotent by Stripe subscription id; no email call. |
| — | Dispute/chargeback | **NOT HANDLED** | No `charge.dispute.*` Stripe event type is subscribed to anywhere. Per the owner's constraint, this is not proposed as new scope — noted only because the brief asked to check. |
| — | Crypto payment (NOWPayments) success | **PARTIAL — event exists, no email** | `app/api/webhooks/nowpayments/route.ts` verifies HMAC-SHA512 IPN signature, checks `FINAL_SUCCESS_STATUSES = {"finished","confirmed"}`, then also calls `subscriptionActionService.activateFromPayment(...)`. Same no-email situation as B01. |

**Refund note:** No code in `SubscriptionActionService`, `StripeProvider`, or `NowPaymentsProvider` ever writes `REFUNDED`/`REVERSED` to `Purchase.status`. That string value exists only as a code comment on the schema column (`prisma/schema.prisma:1229`). No refund-related email is proposed anywhere in this report.

---

## 7. Marketplace/License Mapping (M01–M07)

Traced through `services/licensing/licenseService.ts`, `services/licensing/licenseCore.ts`, `services/licensing/licenseStateMachine.ts`, `app/api/license/{activate,deactivate,validate,status}/route.ts`, `app/api/webhooks/stripe/route.ts`.

| ID | Event | Status | Evidence |
|---|---|---|---|
| M01 | Purchase confirmation | **EXISTS — already built, out of scope for new work** | See Section 3. `app/api/webhooks/stripe/route.ts:90-109` → `sendPurchaseConfirmationEmail`. |
| M02 | License issued | **EXISTS as the same M01 event, no separate email** | `issueLicenseForPurchase` (`services/licensing/licenseService.ts:78`) creates the `License` row in the same transaction the purchase-confirmation email already reports on (`licenseId: result.license.id` is in the M01 email body). There is no separate "license issued" moment distinct from the purchase. |
| M03 | License activated | **PARTIAL — event exists, no email** | `activateLicense(params)` (`services/licensing/licenseService.ts:247-284`) is a real, audited (`recordLicenseAudit`) state transition (`ISSUED → ACTIVE` via `licenseStateMachine.transition`). Called from `app/api/license/activate/route.ts`. No email call anywhere in this path. |
| M04 | Activation failed | **PARTIAL — event exists, no email** | `ActivateOutcome` (`licenseService.ts:241-245`) is a real discriminated union with `UNAUTHORIZED`, `UNKNOWN_PLATFORM`, `ACTIVATION_LIMIT_EXCEEDED`, `LICENSE_NOT_USABLE` failure codes, each audited via `recordLicenseAudit`. Deterministic and specific enough to drive a real email, but nothing does. |
| M05 | License deactivated | **PARTIAL — event exists, no email** | `deactivateLicense(params)` (`services/licensing/licenseService.ts:347`) returns `{ok:true} | {ok:false, code: "UNAUTHORIZED"|"UNKNOWN_PLATFORM"}`. Called from `app/api/license/deactivate/route.ts`. No email. |
| M06 | Version update available | **MISSING EVENT SOURCE** | `ReleaseArtifact.releaseStatus` (`DRAFT\|PUBLISHED\|DEPRECATED\|REVOKED`, `prisma/schema.prisma:1197-1199`) exists, but nothing computes "a buyer's currently-licensed version is now outdated" or notifies anyone when a new `PUBLISHED` release lands for a `tradingSystemId` a buyer already owns. |
| M07 | Fulfillment problem (e.g. license issuance failed after successful payment) | **PARTIAL — event exists as a log line, no notification** | The webhook route's own header comment (`app/api/webhooks/stripe/route.ts:56-62`) explicitly documents this failure mode: if `LICENSE_SIGNING_PRIVATE_KEY`/`PUBLIC_KEY` are unset, `issueLicenseForPurchase` throws, the outer catch (`route.ts:157-162`) logs to `console.error` and returns 500 (Stripe retries), but **no one is emailed** that a paying customer is stuck. This is arguably the highest-severity gap in the whole marketplace path — a real charge with no license, silent except in server logs. |

---

## 8. Credits Mapping (C01–C04)

Two separate credit/usage systems exist; do not conflate them.

**1. Subscription-tier AI-message usage — real, live, deterministic.**
`services/billing/UsageService.ts` wraps `Entitlements.aiMessages` (`{used, limit, remaining, pct, atLimit}`), computed by `EntitlementService` (`services/billing/EntitlementService.ts:52`) from `UsageMeteringService` (`services/billing/UsageMeteringService.ts`). `UsageService.level(used, limit)` (`UsageService.ts:47-52`) already classifies into `"ok" | "warning" | "critical"` at 75%/90% thresholds — this is a ready-made, already-computed signal.

| ID | Event | Status | Evidence |
|---|---|---|---|
| C01 | Credits low (warning) | **PARTIAL — deterministic signal exists, no email** | `UsageService.level()` returns `"warning"` at ≥75% (`UsageService.ts:47-52`). Nothing reads this to trigger a notification; it's currently only consumed for in-dashboard display. |
| C02 | Credits exhausted | **PARTIAL — deterministic signal exists, no email** | Same `level()` returns `"critical"` at ≥90%, and `Entitlements.aiMessages.atLimit` is a direct boolean already computed by `EntitlementService`. No notification wired. |
| C03 | Credits reset (new billing period) | **MISSING EVENT SOURCE** | No code fires an event when a billing period rolls over; `periodStart`/`periodEnd` are read on-demand, not diffed against a previous read anywhere. |
| C04 | Unusual usage pattern | **MISSING EVENT SOURCE** | No anomaly detection of any kind over `AnalyticsEvent` or usage data. |

**2. Agent Framework credit ledger — real schema, NOT YET LIVE.**
`AgentCreditLedgerEntry` (`prisma/schema.prisma:1948-1970`) is a fully designed, append-only, idempotent (`idempotencyKey` unique) accounting ledger for per-tool-call agent costs, with a documented `AgentCreditEntryKind` enum including `refund`/`adjustment`. Its own schema comment states: *"Migration status: GENERATED + REVIEWED, NOT APPLIED"* (line 1935) — i.e., this table does not exist in the production database yet. `services/agent-framework/runtime/agent-runtime.ts:458` and `services/automation/dispatcher.ts:219-223` already reference a `"credit_limit"` terminal/error status for `AgentRun`/`AutomationRun`, so the *event* of an agent/automation run being blocked on credits is real and reachable today even though the underlying ledger table isn't applied. This is explicitly called out in the schema as intentionally separate from the `aiMessages` entitlement pool above (line 1932: *"Pool-unification... is a deliberate follow-on, out of A9 scope"*) — do not conflate the two systems in any future email work.

---

## 9. Automation Mapping (AU01–AU05)

Architecture: `Automation → AutomationRun → AgentRun` (locked, `services/automation/*`, `prisma/schema.prisma:222-238` header comment). `AutomationRun` is the mutable, terminal-state object.

`AutomationRunStatus` enum (`prisma/schema.prisma:253-261`): `QUEUED | RUNNING | SUCCEEDED | FAILED | CONDITION_HALTED | CANCELLED | CREDIT_BLOCKED`.

| ID | Event | Status | Evidence |
|---|---|---|---|
| AU01 | Automation run succeeded | **PARTIAL — event exists, no email** | `AutomationRun.status = SUCCEEDED` is a real terminal write (`services/automation/dispatcher.ts` orchestrates the transition). No dispatch of any kind on success. |
| AU02 | Automation run failed | **PARTIAL — event exists, no email** | `status = FAILED`, with `AutomationRun.error: Json?` populated. `dispatcher.ts:219-223` distinguishes `CREDIT_BLOCKED` from generic `AGENT_RUN_FAILED` via error code — deterministic and specific enough to email from. Nothing does. |
| AU03 | Automation run credit-blocked | **PARTIAL — event exists, no email** | `status = CREDIT_BLOCKED`, set explicitly (`dispatcher.ts:219`) when the underlying `AgentRun` terminates with `"credit_limit"`. Most actionable of the automation failure states (user needs to know to upgrade/wait) and currently silent. |
| AU04 | Automation run halted by condition | **PARTIAL — event exists, no email** | `status = CONDITION_HALTED` — a deliberate (not erroneous) stop; lowest priority for a notification but a real, distinct state. |
| AU05 | Automation schedule failure (e.g. missed slot) | **MISSING EVENT SOURCE** | The `(automationId, scheduledFor)` unique constraint (`prisma/schema.prisma:354-356`) exists to dedupe cron dispatch, but nothing detects or records a slot that was *never* dispatched (as opposed to dispatched-and-failed). |

---

## 10. Agent Mapping (AG01–AG05)

`AgentRunStatus` enum (`prisma/schema.prisma:1654-1669`): `queued | planning | running | awaiting_approval | succeeded | failed | timeout | credit_limit | step_limit | tool_call_limit | permission_denied | tool_error | model_error | cancelled`.

**Important caveat:** the `AgentRun`/`AgentStep`/`AgentToolCall`/`AgentEvidence` schema block carries the same *"GENERATED + REVIEWED, NOT APPLIED"* migration note as the credit ledger (`prisma/schema.prisma:1649-1651`), meaning this is the newer AN-series Agent Framework schema, not yet applied as a migration in production, distinct from the older, already-live `Agent`/`AgentTask`/`AgentMemory`/`AgentActivity` models (`prisma/schema.prisma:149-220`, plain `status: String @default("idle")`, no enum).

| ID | Event | Status | Evidence |
|---|---|---|---|
| AG01 | Agent created | **PARTIAL — event exists, no email** | Old-model `Agent.status` defaults to `"idle"` on creation (`prisma/schema.prisma:156`); creation itself is a real DB write, no notification. |
| AG02 | Agent activated / first run | **MISSING deterministic distinction** | `Agent.lastRun`/`nextRun` are updated by runs, but nothing marks "this is the agent's first successful run" as a distinct event. |
| AG03 | Agent run failed | **PARTIAL — event exists (new schema), no email** | `AgentRunStatus` includes explicit failure/guardrail terminal states (`failed`, `timeout`, `tool_error`, `model_error`, `permission_denied`) — real, structured, and already scored by `services/agent-framework/evaluation/evaluation-service.ts` (`RESOURCE_LIMIT_STATUSES`, `EXPECTED_GUARDRAIL_STATUSES` sets, lines 45-46). No email anywhere. |
| AG04 | Agent needs attention (`awaiting_approval`) | **PARTIAL — event exists, no email** | `awaiting_approval` is a real, named `AgentRunStatus` value — the single most notification-worthy agent state (a human is being asked to act), and it is completely silent today. |
| AG05 | Agent credit-limited | **PARTIAL — same underlying event as C-series/AU03** | `credit_limit` status, set in `services/agent-framework/runtime/agent-runtime.ts:458`. Same caveat as Section 8: the ledger table backing this isn't applied yet, but the *status value* and the code path that sets it are real today. |

---

## 11. Support Mapping (SP01–SP05)

Traced through `services/support/generate-answer.ts`, `services/support/conversation-context.ts`, `services/agent-framework/agents/support-agent.ts`, `services/agent-framework/supervisor/specialists/support.specialist.ts`, `app/api/private/agents/framework/runs/[id]/resolution/route.ts`.

**Finding, stated plainly:** there is no ticket object. Support "escalation" is a structured output flag (`escalate: boolean`, `escalationReason: string | null`) on the same `AgentRun` that answered the question — not a new row in any table, not assigned to a human agent, not queryable as "open tickets." This is confirmed directly in code, not inferred: `services/agent-framework/agents/support-agent.ts:22-23` — *"D5 Unresolved -> a structured escalate:true hand-off. **No ticket is created in this slice (CS2).**"* The referenced "CS2" is a future, not-yet-started sprint.

The only human-facing durable object is the `AgentRun` itself plus its `resolutionConfirmation` metadata field, written by `recordResolutionConfirmation` (`services/agent-framework/api/agent-run-service.ts`), reachable via `POST /api/private/agents/framework/runs/[id]/resolution`. This route (read in full) lets the *end user* confirm their own run was resolved (`{confirmed: boolean}`) — it is not a mechanism for a human support agent to reply.

| ID | Event | Status | Evidence |
|---|---|---|---|
| SP01 | Support request received (question asked) | **PARTIAL — event exists (an AgentRun), no email, no ticket identity** | Every support question is an `AgentRun` of type `support`. Real and durable, but not a "ticket" a human can be assigned. |
| SP02 | Support reply (human responds) | **NOT APPLICABLE — no such capability exists** | There is no human-reply mechanism anywhere in the codebase. The support agent is read-only (D4 lock, `support-agent.ts:17-21`: bound only to `support.knowledge_search` and `support.account_read`, both non-mutating). |
| SP03 | Support resolved | **PARTIAL — real but user-confirmed, not agent/human-driven** | `recordResolutionConfirmation` (gated by `ResolutionNotEligibleError`/`RunNotTerminalError`) writes the user's own "yes this is resolved" onto `AgentRun.metadata`. No email sent on this transition. |
| SP04 | Support reopened | **MISSING EVENT SOURCE** | No concept of reopening exists; a new question is simply a new `AgentRun`. |
| SP05 | Support closed (by staff) | **NOT APPLICABLE — no ticket object, no staff-side action to close** | Same root cause as SP02. |

---

## 12. Security Mapping (S01–S05)

| ID | Event | Status | Evidence |
|---|---|---|---|
| S01 | New login | **PARTIAL — event exists, not device/IP-aware** | `login` is a real, recorded `AnalyticsEventType`, fired from `signInAction` (`app/(auth)/actions/auth.actions.ts:78`) and `app/auth/callback/route.ts:38`. Carries only `userId` + timestamp — no IP, no user-agent, no session identifier. |
| S02 | New device detected | **MISSING EVENT SOURCE** | A repo-wide search for `ipAddress`, `userAgent`, `deviceId` across `services`, `app/api`, and `prisma/schema.prisma` returned no matches tied to auth/session tracking (the only "device" concept in the codebase is `Activation.deviceBindingId`, which belongs to the *licensing* system for EA runtime binding, not to user sessions/security). There is no way today to tell one login apart from another beyond the timestamp. |
| S03 | Security setting changed (e.g. password) | **PARTIAL — overlaps A04** | Same gap as Section 5/A04: `updatePassword` succeeds silently, no event recorded distinct from a generic app action. |
| S04 | Suspicious activity | **MISSING EVENT SOURCE** | No rate-limiting-triggered flag, no anomaly scoring, nothing that would produce a "this login looked wrong" signal. |
| S05 | Account recovery (used a reset link) | **PARTIAL — same infra as A03, no distinct email** | The Supabase-hosted reset-link email (A03) is the closest thing; there is no follow-up "your account was just recovered" confirmation, custom or Supabase-native, beyond Supabase's own reset email content (out of this app's control). |

---

## 13. Platform Ops Mapping (P01–P05)

Confirmed absent, as expected. A repo-wide search for `incident`, `maintenance`, `StatusPage`, `broadcast` returned no matches related to any platform-status or incident-communication system — the handful of hits were unrelated domain terms (e.g. "maintenance" in a strategy-research specialist prompt, "broadcast" nowhere relevant). No further investment warranted here; P01–P05 (maintenance notice, incident, restored, product change, legal update) are all **MISSING — no mechanism of any kind**.

---

## 14. Lifecycle/Marketing Mapping (L01–L07)

Confirmed absent, as expected. No marketing-email provider integration, no mailing-list model, no unsubscribe/consent field anywhere in `prisma/schema.prisma` or `services/`. The only "unsubscribe"/consent-adjacent hits in a repo-wide search were unrelated (a comment in `services/ai/publishing/publisher.service.ts`). L01–L07 are all **MISSING — no mechanism, and per the owner's Non-Goals (Section 18), none should be built as part of this program**.

---

## 15. Email Preference Mapping

The `User` model (`prisma/schema.prisma`, full model read) has exactly these fields: `id, authId, email, name, role, planId, status, emailVerified, stripeCustomerId, createdAt, updatedAt, deletedAt`. **There is no notification-preference concept anywhere in the schema** — no `emailPreferences`, no per-category opt-in/opt-out, no digest-frequency setting, nothing. Any future transactional email system needs to either (a) treat all transactional emails as always-on (standard practice, defensible for purchase/security-class emails) or (b) add a preferences column/table as part of its own migration — this is a real, first-class gap for anything beyond pure transactional email (e.g. optional digests).

---

## 16. Duplicate/Drift Findings

**None found.** `EmailService.ts` (email dispatch) and `AnalyticsEventService.ts` (internal analytics) have disjoint purposes, disjoint call sites, and neither imports the other. No second email-sending implementation, no second "notify user about X" abstraction, and no competing template mechanism were found anywhere in `services/`, `app/`, or `lib/`. The one thing worth flagging as a *soft* drift risk, not a duplicate: the Agent Framework's credit ledger (Section 8, not-yet-applied) and the Billing entitlement pool (`aiMessages`, live) are two genuinely separate credit systems by design (documented as such in the schema), not an accidental duplication — but any future "credits low" email must be built against exactly one of them per event, never both, or the two systems' independent thresholds could double-notify a user for what looks like one underlying "you're low on credits" moment.

---

## 17. Beta Email Matrix

Scope: emails plausible for Beta given what's real today — purchase/marketplace/license, billing where an event genuinely exists, and support where escalation is at least a real (if ticketless) state.

| ID | Email | Trigger | Existing Event | Existing Template | Existing Dispatch | Recipient Data | Idempotency | Status |
|---|---|---|---|---|---|---|---|---|
| M01 | Purchase confirmation | `checkout.session.completed` (marketplace) | YES — `app/api/webhooks/stripe/route.ts:69-112` | YES — `EmailService.ts:39-56` | YES — `sendPurchaseConfirmationEmail` | YES — `prisma.user.email` looked up in-line | YES — gated on `!result.duplicate` from `issueLicenseForPurchase` | **READY (already shipped)** |
| M04 | License activation failed | `activateLicense` returns `{ok:false, code}` | YES — `services/licensing/licenseService.ts:241-245` | NO | NO | YES — `License.buyerId` → `User.email` | PARTIAL — the underlying action is audited (`recordLicenseAudit`) but no dedup key for a *notification* exists yet | **PARTIAL** |
| M07 | Fulfillment problem (payment succeeded, license issuance failed) | Exception inside `issueLicenseForPurchase` from the Stripe webhook | YES — `app/api/webhooks/stripe/route.ts:157-161` (currently only `console.error`) | NO | NO | PARTIAL — buyer identity is in `session.metadata`, but the code path that would need to email is the *failure* path, which today returns before any buyer lookup | NO — Stripe will retry the same event, so a naive email-on-catch would spam on every retry until fixed | **MISSING (highest business risk)** |
| C01/C02 | Credits low / exhausted | `UsageService.level()` reaches `warning`/`critical`, or `Entitlements.aiMessages.atLimit` | PARTIAL — computed synchronously per-request, no event write | NO | NO | YES — session user's email is always available where usage is computed | NO — nothing marks "already notified this period" | **MISSING (needs an event write, not just a read)** |
| AU02/AU03 | Automation run failed / credit-blocked | `AutomationRun.status = FAILED \| CREDIT_BLOCKED` | YES — `services/automation/dispatcher.ts:219-223` | NO | NO | YES — `AutomationRun.userId` → `User.email` | YES — `AutomationRun` is terminal-once, natural idempotency key is the run id | **PARTIAL (best-positioned post-M gap for Beta)** |
| SP01/SP03 | Support escalated / resolved | `AgentRun.output.escalate` / `resolutionConfirmation` | YES — `services/agent-framework/api/agent-run-service.ts` | NO | NO | YES | YES — run id | **PARTIAL, but no ticket object means "escalated" can only notify the requester, never route to a human queue** |
| B01/B07/B08 | Payment success / cancelled / expired | Stripe & NOWPayments webhooks | YES (see Section 6) | NO | NO | YES — `User.email` always resolvable from `userId` | YES — Stripe/NOWPayments event/session ids are natural idempotency keys | **PARTIAL** |

---

## 18. Post-Beta Email Matrix

Scope: everything that needs new event sources, new schema, or a not-yet-authorized feature (automation/agent digests, renewal reminders, upgrade/downgrade, deactivation/version-update, announcements, lifecycle/marketing).

| ID | Email | Trigger | Existing Event | Existing Template | Existing Dispatch | Recipient Data | Idempotency | Status |
|---|---|---|---|---|---|---|---|---|
| A02 | Welcome (post-verification) | `email_verified` analytics event | YES — `app/auth/callback/route.ts:39-41` | NO | NO | YES | YES — the false→true guard already prevents refiring | **PARTIAL — cheapest possible post-Beta win, event already deduped** |
| A04/S03 | Password changed | `AuthService.updatePassword` success | PARTIAL — action exists, no distinct event record | NO | NO | YES | N/A (single action) | **MISSING (needs one line: record + notify after `updatePassword` succeeds)** |
| B03/B04 | Subscription upgraded/downgraded | `SubscriptionActionService.changePlan` | YES — `services/billing/SubscriptionActionService.ts:70-115` | NO | NO | YES | N/A — call site is a single user action, no retry ambiguity | **PARTIAL** |
| B05 | Renewal reminder | N days before `currentPeriodEnd` | MISSING EVENT SOURCE — no scheduled job reads this field for this purpose | NO | NO | YES (data exists) | N/A — would need a new dedup key (e.g. "reminded for period X") | **MISSING** |
| B06 | Payment failed | Stripe `invoice.payment_failed` | MISSING EVENT SOURCE — event type not subscribed | NO | NO | YES | N/A | **MISSING** |
| M03/M05 | License activated/deactivated | `activateLicense`/`deactivateLicense` | YES (Section 7) | NO | NO | YES | YES — audited per-call | **PARTIAL** |
| M06 | New version available for an owned license | New `ReleaseArtifact` with `releaseStatus=PUBLISHED` for an owned `tradingSystemId` | MISSING EVENT SOURCE | NO | NO | YES (joinable) | N/A | **MISSING** |
| AG04 | Agent needs approval (`awaiting_approval`) | `AgentRun.status = awaiting_approval` | YES — real enum value, schema not yet applied to prod | NO | NO | YES | YES — run id | **MISSING (blocked on the AN-series migration being applied at all)** |
| AU05 | Missed automation schedule | Scheduled slot never dispatched | MISSING EVENT SOURCE | NO | NO | YES | N/A | **MISSING** |
| C03/C04 | Credit reset / unusual usage | Billing period rollover / anomaly | MISSING EVENT SOURCE | NO | NO | YES | N/A | **MISSING** |
| S01/S02/S04 | New login / new device / suspicious activity | Login with device fingerprint | MISSING EVENT SOURCE (no IP/device capture at all) | NO | NO | YES | N/A | **MISSING (needs new capture infra before any template work)** |
| P01–P05 | Platform ops (maintenance/incident/etc.) | N/A | MISSING EVENT SOURCE | NO | NO | N/A | N/A | **MISSING — explicit non-goal for now** |
| L01–L07 | Lifecycle/marketing | N/A | MISSING EVENT SOURCE | NO | NO | N/A | N/A | **MISSING — explicit non-goal (Section 19)** |

---

## 19. Missing Event Sources

- Billing period rollover (for C03) and any usage-anomaly scoring (C04).
- Stripe `invoice.payment_failed` / any NOWPayments failure-status subscription (B06).
- Renewal look-ahead job over `Subscription.currentPeriodEnd` (B05).
- "First successful automation run" / "first agent run" distinctions (AG02).
- Missed (never-dispatched) automation schedule slots (AU05).
- New-`ReleaseArtifact`-published-for-an-owned-license detection (M06).
- Any login-session metadata (IP, user-agent, device fingerprint) — currently zero capture (S01 partial, S02/S04 fully missing).
- Support ticket lifecycle events (SP02, SP04, SP05) — blocked entirely on a ticket object not existing (CS2, not yet started).

## 20. Missing Data Sources

- No IP/device/session table exists to join against for any security email.
- No notification-preference data on `User` (Section 15) — needed before sending anything a user might reasonably want to turn off (digests, marketing, even some security alerts).
- No "already notified for period X" or "already notified at threshold Y" marker for any of the credit/usage/renewal cases — every one of them needs a new small table or column to avoid re-sending on every request/poll.

## 21. Missing Template Infrastructure

Every email beyond the one purchase-confirmation template would today be hand-inlined HTML in whatever file calls `Resend` directly, exactly as `EmailService.ts` does now. There is no shared layout/partial system, no brand-header/footer component, no plain-text fallback generation, and no localization. This is fine at n=1 template; it will not scale past 3-4 without becoming its own maintenance burden.

## 22. Missing Dispatch Infrastructure

There is no queue, no retry-with-backoff, no dead-letter handling, and no delivery-status logging (Resend returns a message id today; nothing persists it). Every dispatch today is a single synchronous `await` inside the triggering request/webhook handler, protected only by an outer try/catch that swallows failures to a `console.error`. This is an acceptable pattern for exactly one low-volume, non-critical-path email; it is not a pattern to keep copy-pasting as more triggers are added.

## 23. Idempotency/Retry Gaps

The one thing done right today (M01) has real idempotency, inherited for free from `issueLicenseForPurchase`'s own dedup on `providerRef` (`session.id`) — the email only fires when `!result.duplicate`. Nothing else in this report has an equivalent guard designed in yet: any new dispatch point must either (a) key off an already-idempotent domain action the way M01 does (billing webhooks, license state transitions, automation run terminal states all qualify), or (b) get its own new "already sent" marker (credits/renewal/anomaly-style triggers, which are polled/computed rather than event-driven).

---

## 24. Recommended Canonical Architecture

A single pipeline, event → notification-decision → template → provider → delivery-logging, generalizing the pattern `EmailService.ts` already established rather than replacing it:

1. **Event.** Reuse an already-idempotent domain action's terminal state wherever one exists (Stripe/NOWPayments webhook events, `AutomationRun`/`AgentRun` terminal statuses, `License` state-machine transitions). Only build new event capture (login metadata, billing-period rollover, release-published-for-owned-license) where Section 19 shows none exists.
2. **Notification-decision.** A thin, pure function per event type that decides *whether* to notify (dedup key check, e.g. "already sent for this run id / this billing period / this threshold") — this is the one piece missing even from the one email that exists today only because M01's dedup happens to be borrowed from the license system, not owned by the email layer itself.
3. **Template.** Extract `EmailService.ts`'s inline HTML into a small shared layout (header/footer/brand chrome) with each email type providing only its body — still plain functions, no new dependency, before more than 2-3 templates accumulate.
4. **Provider.** Keep `Resend` as the sole provider (already verified domain, already installed SDK) — no reason to add a second provider for Beta-era volume.
5. **Delivery-logging.** Persist the Resend response id + outcome (a small `EmailLog` table: `type, recipientUserId, providerMessageId, status, sentAt`) — this closes both the "did we already send this" idempotency gap and gives the owner/support a real audit trail, something that does not exist even for the one email sent today.

This is presented as a target shape, not a proposal to build it now — see Section 26.

## 25. Explicit Non-Goals

- **No refund flow.** `Purchase.status`'s `REFUNDED`/`REVERSED` values remain untouched, undesigned, and un-triggered. Nothing in this report proposes building refund logic, a refund email, or a refund UI.
- **No marketing automation.** Sections 14/18 confirm zero existing infrastructure for lifecycle/marketing email; none is proposed.
- **No parallel notification system.** Any future work extends `EmailService.ts`'s pattern (Section 24); it does not introduce a second, competing way to notify users.

## 26. Implementation Sequence Proposal

Based strictly on what this discovery found *ready* versus *not*, not on the owner's original full wishlist:

1. **M07 (fulfillment-problem alert to the owner/ops inbox, not the buyer)** — this is the single highest-risk silent gap found (a real charge with a stuck license, currently only a server log line). Smallest possible first sprint: one internal-facing email (to `billing@` or an ops address, not customer-facing copy/template work) fired from the existing catch block at `app/api/webhooks/stripe/route.ts:157-161`, guarded by a simple "don't re-alert on every Stripe retry of the same event" check.
2. **AU02/AU03 (automation failed / credit-blocked, to the automation's owner)** — second-best-positioned: real, terminal, already-idempotent-by-run-id state, directly actionable by the user (retry, upgrade), and the automation product itself is already live.
3. **A02 (welcome email)** — cheapest genuinely customer-facing win: the trigger is already deduped (Section 18), needs only a template and a dispatch call at an existing, well-understood code location.
4. Everything else in Sections 17-18 waits on either a real event source being built first (credits, renewal, security) or a product decision the owner hasn't made yet (support ticketing/CS2).

This is a recommendation for the owner to accept, modify, or reject — no code from this list has been written.

## 27. Final Reconciliation Gate

This document is the complete output of a discovery-only sprint. No application code, Prisma schema, package.json, or configuration file was created, edited, or deleted to produce it. Nothing described as "MISSING," "PARTIAL," or part of the Post-Beta matrix has been implemented. The one file this sprint added to the repository is this markdown document itself.
